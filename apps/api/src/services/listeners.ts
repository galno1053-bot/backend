import { createPublicClient, formatEther, http } from "viem";
import { sepolia } from "viem/chains";
import { Connection, PublicKey } from "@solana/web3.js";
import { prisma } from "../db.js";
import { config } from "../config.js";
import pino from "pino";

const log = pino({ name: "listeners" });

const escrowAbi = [
  {
    "type": "event",
    "name": "Deposit",
    "inputs": [
      { "indexed": true, "name": "user", "type": "address" },
      { "indexed": false, "name": "amount", "type": "uint256" }
    ]
  }
];

export const startEvmListener = async () => {
  if (!config.escrowEvmAddress) {
    log.warn("EVM escrow not configured; skipping listener");
    return;
  }
  const client = createPublicClient({ chain: sepolia, transport: http(config.evmRpcUrl) });

  client.watchContractEvent({
    address: config.escrowEvmAddress as `0x${string}`,
    abi: escrowAbi,
    eventName: "Deposit",
    onLogs: async (logs) => {
      for (const entry of logs) {
        const txHash = entry.transactionHash;
        const existing = await prisma.depositTx.findUnique({ where: { txHash } });
        if (existing) continue;
        const userAddress = (entry.args?.user as string)?.toLowerCase();
        if (!userAddress) continue;
        const amountWei = entry.args?.amount as bigint;
        const amount = Number(formatEther(amountWei));

        let user = await prisma.user.findFirst({ where: { evmAddress: userAddress } });
        if (!user) {
          const shortName = `${userAddress.slice(0, 6)}...${userAddress.slice(-4)}`;
          user = await prisma.user.create({
            data: { evmAddress: userAddress, username: shortName }
          });
        }

        await prisma.$transaction([
          prisma.depositTx.create({
            data: {
              userId: user.id,
              chain: "EVM",
              txHash,
              amount,
              confirmations: config.evmConfirmations
            }
          }),
          prisma.ledgerEntry.create({
            data: {
              userId: user.id,
              type: "DEPOSIT",
              amount,
              chain: "EVM",
              txHash
            }
          })
        ]);
      }
    }
  });

  log.info("EVM listener started");
};

export const startSolanaListener = async () => {
  if (!config.escrowSolanaProgramId) {
    log.warn("Solana escrow not configured; skipping listener");
    return;
  }
  const connection = new Connection(config.solanaRpcUrl, "confirmed");
  const programId = new PublicKey(config.escrowSolanaProgramId);

  connection.onLogs(programId, async (logInfo) => {
    const signature = logInfo.signature;
    const existing = await prisma.depositTx.findUnique({ where: { txHash: signature } });
    if (existing) return;

    const line = logInfo.logs.find((l) => l.includes("GALNO_DEPOSIT"));
    if (!line) return;
    const match = line.match(/user=(\w+) amount=(\d+)/);
    if (!match) return;

    const userAddress = match[1];
    const lamports = Number(match[2]);
    const amount = lamports / 1e9;

    let user = await prisma.user.findFirst({ where: { solAddress: userAddress } });
    if (!user) {
      const shortName = `${userAddress.slice(0, 4)}...${userAddress.slice(-4)}`;
      user = await prisma.user.create({
        data: { solAddress: userAddress, username: shortName }
      });
    }

    await prisma.$transaction([
      prisma.depositTx.create({
        data: {
          userId: user.id,
          chain: "SOL",
          txHash: signature,
          amount,
          confirmations: config.solConfirmations
        }
      }),
      prisma.ledgerEntry.create({
        data: {
          userId: user.id,
          type: "DEPOSIT",
          amount,
          chain: "SOL",
          txHash: signature
        }
      })
    ]);
  }, "confirmed");

  log.info("Solana listener started");
};
