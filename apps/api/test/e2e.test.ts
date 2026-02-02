import { describe, expect, it, vi, beforeAll, afterAll } from "vitest";
import { GameEngine } from "../src/game.js";
import { prisma } from "../src/db.js";

const shouldRun = process.env.RUN_E2E === "1";

describe.skipIf(!shouldRun)("e2e game flow", () => {
  beforeAll(async () => {
    await prisma.ledgerEntry.deleteMany();
    await prisma.bet.deleteMany();
    await prisma.round.deleteMany();
    await prisma.chatMessage.deleteMany();
    await prisma.user.deleteMany();
  });

  afterAll(async () => {
    await prisma.$disconnect();
    vi.useRealTimers();
  });

  it("creates round, places bet, cashout or crash updates ledger", async () => {
    vi.useFakeTimers();
    const io = { emit: () => {} } as any;
    const game = new GameEngine(io, { seedFn: () => "seed", clientSeed: "client" });

    const user = await prisma.user.create({ data: { username: "tester", evmAddress: "0xtest" } });
    await prisma.ledgerEntry.create({
      data: { userId: user.id, type: "DEPOSIT", amount: 1, chain: "EVM" }
    });

    await game.start();
    const betResult = await game.placeBet(user.id, 0.5);
    expect(betResult.ok).toBe(true);

    await vi.advanceTimersByTimeAsync(5200);
    const cashoutResult = await game.cashout(user.id);

    await vi.advanceTimersByTimeAsync(20000);

    const bet = await prisma.bet.findFirst({ where: { userId: user.id } });
    expect(bet).toBeTruthy();

    const ledger = await prisma.ledgerEntry.findMany({ where: { userId: user.id } });
    const hasBet = ledger.some((l) => l.type === "BET");
    expect(hasBet).toBe(true);

    if (cashoutResult.ok) {
      const hasPayout = ledger.some((l) => l.type === "PAYOUT");
      expect(hasPayout).toBe(true);
    } else {
      expect(bet?.status).toBe("LOST");
    }
  }, 30000);
});
