import { config } from "../config.js";
import { privateKeyToAccount } from "viem/accounts";
import { createPublicClient, createWalletClient, http, parseEther } from "viem";
import { sepolia } from "viem/chains";
import { PublicKey, Connection, Keypair, SystemProgram, Transaction, TransactionInstruction } from "@solana/web3.js";
import bs58 from "bs58";

const escrowAbi = [
  {
    "type": "function",
    "name": "withdraw",
    "stateMutability": "nonpayable",
    "inputs": [
      { "name": "to", "type": "address" },
      { "name": "amount", "type": "uint256" }
    ],
    "outputs": []
  }
];

export const sendEvmWithdraw = async (user: { evmAddress?: string | null }, amount: number) => {
  if (!config.escrowEvmAddress || !config.escrowEvmOwnerKey) {
    throw new Error("EVM escrow not configured");
  }
  if (!user.evmAddress) throw new Error("User has no EVM address");
  const account = privateKeyToAccount(config.escrowEvmOwnerKey as `0x${string}`);
  const walletClient = createWalletClient({ account, chain: sepolia, transport: http(config.evmRpcUrl) });
  const publicClient = createPublicClient({ chain: sepolia, transport: http(config.evmRpcUrl) });

  const hash = await walletClient.writeContract({
    address: config.escrowEvmAddress as `0x${string}`,
    abi: escrowAbi,
    functionName: "withdraw",
    args: [user.evmAddress as `0x${string}`, parseEther(amount.toString())]
  });
  await publicClient.waitForTransactionReceipt({ hash });
  return hash;
};

const buildWithdrawIx = async (programId: PublicKey, authority: PublicKey, vault: PublicKey, recipient: PublicKey, lamports: bigint) => {
  const data = Buffer.alloc(9);
  data.writeUInt8(1, 0);
  data.writeBigUInt64LE(lamports, 1);
  return new TransactionInstruction({
    programId,
    keys: [
      { pubkey: authority, isSigner: true, isWritable: true },
      { pubkey: vault, isSigner: false, isWritable: true },
      { pubkey: recipient, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }
    ],
    data
  });
};

export const sendSolanaWithdraw = async (user: { solAddress?: string | null }, amount: number) => {
  if (!config.escrowSolanaProgramId || !config.escrowSolanaAuthorityKey) {
    throw new Error("Solana escrow not configured");
  }
  if (!user.solAddress) throw new Error("User has no Solana address");

  const connection = new Connection(config.solanaRpcUrl, "confirmed");
  const authority = Keypair.fromSecretKey(bs58.decode(config.escrowSolanaAuthorityKey));
  const programId = new PublicKey(config.escrowSolanaProgramId);
  const recipient = new PublicKey(user.solAddress);
  const [vault] = PublicKey.findProgramAddressSync([Buffer.from("vault")], programId);
  const lamports = BigInt(Math.floor(amount * 1e9));

  const ix = await buildWithdrawIx(programId, authority.publicKey, vault, recipient, lamports);
  const tx = new Transaction().add(ix);
  const sig = await connection.sendTransaction(tx, [authority]);
  await connection.confirmTransaction(sig, "confirmed");
  return sig;
};
