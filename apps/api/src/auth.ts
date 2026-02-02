import jwt from "jsonwebtoken";
import crypto from "node:crypto";
import { verifyMessage } from "viem";
import nacl from "tweetnacl";
import bs58 from "bs58";
import { PublicKey } from "@solana/web3.js";
import { config } from "./config.js";
import { prisma } from "./db.js";

const nonceStore = new Map<string, string>();

export const buildNonceMessage = (address: string, nonce: string) => {
  return `Galno login\nAddress: ${address}\nNonce: ${nonce}`;
};

export const issueNonce = (address: string) => {
  const nonce = crypto.randomUUID();
  nonceStore.set(address.toLowerCase(), nonce);
  return nonce;
};

export const verifyEvmSignature = async (address: string, signature: string) => {
  const nonce = nonceStore.get(address.toLowerCase());
  if (!nonce) return false;
  const message = buildNonceMessage(address, nonce);
  return verifyMessage({ address: address as `0x${string}`, message, signature: signature as `0x${string}` });
};

export const verifySolSignature = (address: string, signature: string) => {
  const nonce = nonceStore.get(address.toLowerCase());
  if (!nonce) return false;
  const message = buildNonceMessage(address, nonce);
  const publicKey = new PublicKey(address);
  const sigBytes = bs58.decode(signature);
  return nacl.sign.detached.verify(new TextEncoder().encode(message), sigBytes, publicKey.toBytes());
};

export const clearNonce = (address: string) => {
  nonceStore.delete(address.toLowerCase());
};

export const issueJwt = (userId: string) => {
  return jwt.sign({ sub: userId }, config.jwtSecret, { expiresIn: "2h" });
};

export const getUserFromToken = async (token: string) => {
  try {
    const payload = jwt.verify(token, config.jwtSecret) as { sub: string };
    return prisma.user.findUnique({ where: { id: payload.sub } });
  } catch {
    return null;
  }
};
