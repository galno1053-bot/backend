import { prisma } from "./db.js";

export const getBalance = async (userId: string) => {
  const entries = await prisma.ledgerEntry.findMany({ where: { userId } });
  let total = 0;
  for (const entry of entries) {
    total += Number(entry.amount);
  }
  return total;
};
