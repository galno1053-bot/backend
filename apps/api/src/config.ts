import dotenv from "dotenv";

dotenv.config();

const env = (key: string, fallback?: string): string => {
  const value = process.env[key] ?? fallback;
  if (value === undefined) {
    throw new Error(`Missing env var ${key}`);
  }
  return value;
};

export const config = {
  port: Number(process.env.PORT ?? 4000),
  jwtSecret: env("JWT_SECRET"),
  evmChain: process.env.EVM_CHAIN ?? "sepolia",
  solanaCluster: process.env.SOLANA_CLUSTER ?? "devnet",
  evmRpcUrl: env("EVM_RPC_URL"),
  solanaRpcUrl: env("SOLANA_RPC_URL"),
  escrowEvmAddress: process.env.EVM_ESCROW_ADDRESS ?? "",
  escrowEvmOwnerKey: process.env.EVM_ESCROW_OWNER_PRIVATE_KEY ?? "",
  escrowSolanaProgramId: process.env.SOLANA_ESCROW_PROGRAM_ID ?? "",
  escrowSolanaAuthorityKey: process.env.SOLANA_ESCROW_AUTHORITY_KEY ?? "",
  evmConfirmations: Number(process.env.EVM_CONFIRMATIONS ?? 1),
  solConfirmations: Number(process.env.SOLANA_CONFIRMATIONS ?? 1)
};
