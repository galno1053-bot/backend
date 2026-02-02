import { Router } from "express";
import { z } from "zod";
import { prisma } from "./db.js";
import { buildNonceMessage, clearNonce, getUserFromToken, issueJwt, issueNonce, verifyEvmSignature, verifySolSignature } from "./auth.js";
import { getBalance } from "./ledger.js";
import { GameEngine, computeCrashPoint } from "./game.js";
import { sendEvmWithdraw, sendSolanaWithdraw } from "./services/withdraw.js";

export const buildRouter = (game: GameEngine) => {
  const router = Router();

  router.get("/health", (_req, res) => res.json({ ok: true }));

  router.post("/auth/nonce", async (req, res) => {
    const schema = z.object({ address: z.string().min(10) });
    const { address } = schema.parse(req.body);
    const nonce = issueNonce(address);
    res.json({ nonce, message: buildNonceMessage(address, nonce) });
  });

  router.post("/auth/verify", async (req, res) => {
    const schema = z.object({
      address: z.string().min(10),
      signature: z.string().min(10),
      chain: z.enum(["EVM", "SOL"])
    });
    const { address, signature, chain } = schema.parse(req.body);
    const ok = chain === "EVM" ? await verifyEvmSignature(address, signature) : verifySolSignature(address, signature);
    if (!ok) return res.status(401).json({ error: "Invalid signature" });

    let user = await prisma.user.findFirst({
      where: chain === "EVM" ? { evmAddress: address.toLowerCase() } : { solAddress: address }
    });
    if (!user) {
      const shortName = chain === "EVM"
        ? `${address.slice(0, 6)}...${address.slice(-4)}`
        : `${address.slice(0, 4)}...${address.slice(-4)}`;
      user = await prisma.user.create({
        data: {
          evmAddress: chain === "EVM" ? address.toLowerCase() : null,
          solAddress: chain === "SOL" ? address : null,
          username: shortName
        }
      });
    }
    clearNonce(address);
    const token = issueJwt(user.id);
    res.json({ token, user });
  });

  router.get("/me", async (req, res) => {
    const token = req.headers.authorization?.replace("Bearer ", "");
    if (!token) return res.status(401).json({ error: "Unauthorized" });
    const user = await getUserFromToken(token);
    if (!user) return res.status(401).json({ error: "Unauthorized" });
    const balance = await getBalance(user.id);
    res.json({ user, balance });
  });

  router.get("/round/current", (_req, res) => {
    res.json(game.getState());
  });

  router.get("/round/history", async (req, res) => {
    const limit = Number(req.query.limit ?? 100);
    const rounds = await prisma.round.findMany({
      orderBy: { createdAt: "desc" },
      take: Math.min(limit, 100)
    });
    res.json(rounds);
  });

  router.get("/leaderboard", async (req, res) => {
    const range = z.enum(["24h", "7d", "30d"]).parse(req.query.range ?? "7d");
    const now = Date.now();
    const ms = range === "24h" ? 24 * 3600 * 1000 : range === "7d" ? 7 * 24 * 3600 * 1000 : 30 * 24 * 3600 * 1000;
    const since = new Date(now - ms);

    const results = await prisma.bet.groupBy({
      by: ["userId"],
      where: { createdAt: { gte: since } },
      _sum: { profit: true }
    });

    const users = await prisma.user.findMany({ where: { id: { in: results.map((r) => r.userId) } } });

    const rows = results
      .map((r) => ({
        userId: r.userId,
        profit: Number(r._sum.profit ?? 0),
        username: users.find((u) => u.id === r.userId)?.username ?? "anon"
      }))
      .sort((a, b) => b.profit - a.profit)
      .slice(0, 50);

    res.json(rows);
  });

  router.get("/chat/history", async (_req, res) => {
    const messages = await prisma.chatMessage.findMany({
      orderBy: { createdAt: "desc" },
      take: 200,
      include: { user: true }
    });
    res.json(
      messages
        .reverse()
        .map((m) => ({
          id: m.id,
          userId: m.userId,
          username: m.user.username,
          text: m.text,
          createdAt: m.createdAt.toISOString()
        }))
    );
  });

  router.get("/provablyfair/commit", (_req, res) => {
    res.json({
      roundId: game.getState().id,
      serverSeedHash: game.getState().serverSeedHash,
      clientSeed: game.getState().clientSeed,
      nonce: game.getState().nonce
    });
  });

  router.post("/provablyfair/verify", (req, res) => {
    const schema = z.object({
      serverSeed: z.string(),
      clientSeed: z.string(),
      nonce: z.number(),
      roundId: z.string()
    });
    const { serverSeed, clientSeed, nonce, roundId } = schema.parse(req.body);
    const crashPoint = computeCrashPoint(serverSeed, clientSeed, nonce, roundId);
    res.json({ crashPoint });
  });

  router.post("/client-seed", (req, res) => {
    const schema = z.object({ seed: z.string().min(3).max(128) });
    const { seed } = schema.parse(req.body);
    game.setClientSeed(seed);
    res.json({ ok: true, seed });
  });

  router.post("/withdraw", async (req, res) => {
    const schema = z.object({ amount: z.number().positive(), chain: z.enum(["EVM", "SOL"]) });
    const token = req.headers.authorization?.replace("Bearer ", "");
    if (!token) return res.status(401).json({ error: "Unauthorized" });
    const user = await getUserFromToken(token);
    if (!user) return res.status(401).json({ error: "Unauthorized" });

    const { amount, chain } = schema.parse(req.body);
    const balance = await getBalance(user.id);
    if (balance < amount) return res.status(400).json({ error: "Insufficient balance" });

    const txHash = chain === "EVM"
      ? await sendEvmWithdraw(user, amount)
      : await sendSolanaWithdraw(user, amount);

    await prisma.$transaction([
      prisma.ledgerEntry.create({
        data: {
          userId: user.id,
          type: "WITHDRAW",
          amount: -amount,
          chain
        }
      }),
      prisma.withdrawTx.create({
        data: {
          userId: user.id,
          chain,
          txHash,
          amount
        }
      })
    ]);

    res.json({ ok: true, txHash });
  });

  return router;
};
