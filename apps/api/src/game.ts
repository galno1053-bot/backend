import crypto from "node:crypto";
import { Server as SocketServer } from "socket.io";
import { prisma } from "./db.js";
import { getBalance } from "./ledger.js";
import { canCashout, canPlaceBet } from "./betRules.js";

export type GameStatus = "WAITING" | "RUNNING" | "CRASHED";

const WAITING_MS = 5000;
const TICK_MS = 90;
const GROWTH_K = 0.105;

const hmacSha256 = (key: string, message: string) => {
  return crypto.createHmac("sha256", key).update(message).digest("hex");
};

const crashFromHash = (hashHex: string) => {
  const h = parseInt(hashHex.slice(0, 13), 16);
  const e = 2 ** 52;
  const raw = (100 * e - h) / (e - h);
  const crash = Math.max(1, Math.floor(raw) / 100);
  return Number(crash.toFixed(2));
};

const seededFloat = (seed: string, index: number) => {
  const hash = crypto.createHash("sha256").update(`${seed}:${index}`).digest();
  return hash.readUInt32BE(0) / 0xffffffff;
};

export const computeCrashPoint = (serverSeed: string, clientSeed: string, nonce: number, roundId: string) => {
  const message = `${clientSeed}:${nonce}:${roundId}`;
  const hash = hmacSha256(serverSeed, message);
  return crashFromHash(hash);
};

export class GameEngine {
  private io: SocketServer;
  private seedFn: () => string;
  private status: GameStatus = "WAITING";
  private currentRoundId: string | null = null;
  private serverSeed = "";
  private serverSeedHash = "";
  private clientSeed: string = crypto.randomUUID();
  private nonce = 0;
  private crashPoint = 1;
  private startedAt: number | null = null;
  private waitingUntil: number | null = null;
  private noise = 0;
  private trend = 0;
  private trendSlope = 0;
  private trendUntil = 0;
  private currentMultiplier = 1;
  private waitingTimeout?: NodeJS.Timeout;
  private tickInterval?: NodeJS.Timeout;

  constructor(io: SocketServer, options?: { seedFn?: () => string; clientSeed?: string }) {
    this.io = io;
    this.seedFn = options?.seedFn ?? (() => crypto.randomUUID());
    if (options?.clientSeed) {
      this.clientSeed = options.clientSeed;
    }
  }

  public getState() {
    return {
      id: this.currentRoundId,
      status: this.status,
      startedAt: this.startedAt ? new Date(this.startedAt).toISOString() : null,
      crashPoint: this.status === "CRASHED" ? this.crashPoint : null,
      serverSeedHash: this.serverSeedHash,
      serverSeedRevealed: this.status === "CRASHED" ? this.serverSeed : null,
      clientSeed: this.clientSeed,
      nonce: this.nonce,
      waitingEndsAt: this.status === "WAITING" ? this.waitingUntil : null
    };
  }

  public setClientSeed(seed: string) {
    this.clientSeed = seed;
  }

  public async start() {
    await this.startWaiting();
  }

  public async placeBet(userId: string, amount: number) {
    if (!canPlaceBet(this.status) || !this.currentRoundId) {
      return { ok: false, error: "Betting only allowed during waiting." };
    }
    if (amount <= 0) {
      return { ok: false, error: "Invalid amount." };
    }
    const existing = await prisma.bet.findFirst({ where: { userId, roundId: this.currentRoundId } });
    if (existing) {
      return { ok: false, error: "Bet already placed." };
    }
    const balance = await getBalance(userId);
    if (balance < amount) {
      return { ok: false, error: "Insufficient balance." };
    }

    const user = await prisma.user.findUnique({ where: { id: userId } });
    const chain = user?.evmAddress ? "EVM" : "SOL";

    await prisma.$transaction([
      prisma.bet.create({
        data: {
          userId,
          roundId: this.currentRoundId,
          amount,
          status: "ACTIVE"
        }
      }),
      prisma.ledgerEntry.create({
        data: {
          userId,
          type: "BET",
          amount: -amount,
          chain
        }
      })
    ]);

    return { ok: true };
  }

  public async cashout(userId: string) {
    if (!canCashout(this.status) || !this.currentRoundId) {
      return { ok: false, error: "Cashout only allowed during running." };
    }
    const bet = await prisma.bet.findFirst({ where: { userId, roundId: this.currentRoundId, status: "ACTIVE" } });
    if (!bet) {
      return { ok: false, error: "No active bet." };
    }
    const multiplier = this.currentMultiplier;
    if (multiplier >= this.crashPoint) {
      return { ok: false, error: "Crash already happened." };
    }

    const profit = Number(bet.amount) * multiplier - Number(bet.amount);
    const user = await prisma.user.findUnique({ where: { id: userId } });
    const chain = user?.evmAddress ? "EVM" : "SOL";

    await prisma.$transaction([
      prisma.bet.update({
        where: { id: bet.id },
        data: {
          status: "CASHED_OUT",
          cashedOutAtMultiplier: Number(multiplier.toFixed(2)),
          profit
        }
      }),
      prisma.ledgerEntry.create({
        data: {
          userId,
          type: "PAYOUT",
          amount: profit + Number(bet.amount),
          chain
        }
      })
    ]);

    return { ok: true, multiplier: Number(multiplier.toFixed(2)) };
  }

  private rollTrend(now: number) {
    const duration = 1200 + Math.random() * 2200;
    this.trendUntil = now + duration;
    const downBias = Math.random();
    if (downBias < 0.35) {
      this.trendSlope = -(0.08 + Math.random() * 0.14);
    } else {
      this.trendSlope = 0.04 + Math.random() * 0.16;
    }
  }

  private async startWaiting() {
    this.status = "WAITING";
    this.startedAt = null;
    this.waitingUntil = Date.now() + WAITING_MS;
    this.serverSeed = this.seedFn() + this.seedFn();
    this.serverSeedHash = crypto.createHash("sha256").update(this.serverSeed).digest("hex");
    this.nonce += 1;

    const round = await prisma.round.create({
      data: {
        status: "WAITING",
        serverSeedHash: this.serverSeedHash,
        clientSeed: this.clientSeed,
        nonce: this.nonce
      }
    });
    this.currentRoundId = round.id;
    this.crashPoint = computeCrashPoint(this.serverSeed, this.clientSeed, this.nonce, round.id);

    this.io.emit("round:state", {
      status: this.status,
      waitingMs: WAITING_MS,
      waitingEndsAt: this.waitingUntil,
      roundId: round.id,
      serverSeedHash: this.serverSeedHash,
      clientSeed: this.clientSeed,
      nonce: this.nonce
    });

    this.waitingTimeout = setTimeout(() => this.startRunning(), WAITING_MS);
  }

  private async startRunning() {
    if (!this.currentRoundId) return;
    this.status = "RUNNING";
    this.startedAt = Date.now();
    this.waitingUntil = null;
    this.noise = 0;
    this.trend = 0;
    this.trendSlope = 0;
    this.trendUntil = 0;
    this.currentMultiplier = 1;
    this.rollTrend(Date.now());
    await prisma.round.update({
      where: { id: this.currentRoundId },
      data: { status: "RUNNING", startedAt: new Date(this.startedAt) }
    });

    this.io.emit("round:state", {
      status: this.status,
      roundId: this.currentRoundId,
      serverSeedHash: this.serverSeedHash,
      clientSeed: this.clientSeed,
      nonce: this.nonce,
      waitingEndsAt: this.waitingUntil
    });

    this.tickInterval = setInterval(() => this.tick(), TICK_MS);
  }

  private async tick() {
    if (this.status !== "RUNNING" || !this.startedAt) return;
    const elapsed = (Date.now() - this.startedAt) / 1000;
    const base = Math.exp(GROWTH_K * elapsed);
    const now = Date.now();
    if (now >= this.trendUntil) {
      this.rollTrend(now);
    }
    const dt = TICK_MS / 1000;
    this.trend += this.trendSlope * dt;
    this.trend = Math.max(-0.4, Math.min(0.4, this.trend));
    this.noise = this.noise * 0.99 + (Math.random() - 0.5) * 0.008;
    this.noise = Math.max(-0.12, Math.min(0.12, this.noise));
    const multiplier = Math.max(0.3, base * Math.exp(this.trend + this.noise));
    this.currentMultiplier = multiplier;

    this.io.emit("round:tick", {
      t: elapsed,
      currentMultiplier: Number(multiplier.toFixed(2))
    });

    if (multiplier >= this.crashPoint) {
      this.currentMultiplier = this.crashPoint;
      this.io.emit("round:tick", {
        t: elapsed,
        currentMultiplier: Number(this.currentMultiplier.toFixed(2))
      });
      await this.crash();
    }
  }

  private async crash() {
    if (!this.currentRoundId) return;
    if (this.tickInterval) clearInterval(this.tickInterval);
    this.status = "CRASHED";
    const endedAt = new Date();

    await prisma.round.update({
      where: { id: this.currentRoundId },
      data: {
        status: "CRASHED",
        endedAt,
        crashPoint: this.crashPoint,
        serverSeedRevealed: this.serverSeed
      }
    });

    const activeBets = await prisma.bet.findMany({
      where: { roundId: this.currentRoundId, status: "ACTIVE" }
    });

    if (activeBets.length > 0) {
      await prisma.$transaction(
        activeBets.map((bet) =>
          prisma.bet.update({
            where: { id: bet.id },
            data: {
              status: "LOST",
              profit: -Number(bet.amount)
            }
          })
        )
      );
    }

    this.io.emit("round:crash", {
      roundId: this.currentRoundId,
      crashPoint: this.crashPoint,
      serverSeed: this.serverSeed,
      clientSeed: this.clientSeed,
      nonce: this.nonce
    });

    setTimeout(() => this.startWaiting(), 1500);
  }
}
