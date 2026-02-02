export type RoundStatus = "WAITING" | "RUNNING" | "CRASHED";

export type ChainType = "EVM" | "SOL";

export interface RoundState {
  id: string;
  status: RoundStatus;
  startedAt: string | null;
  endedAt: string | null;
  crashPoint: number | null;
  serverSeedHash: string;
  serverSeedRevealed: string | null;
  clientSeed?: string;
  nonce?: number;
}

export interface RoundTick {
  t: number;
  currentMultiplier: number;
}

export interface BetDTO {
  id: string;
  amount: string;
  status: "ACTIVE" | "CASHED_OUT" | "LOST";
  cashedOutAtMultiplier: number | null;
  profit: string | null;
}

export interface LeaderboardRow {
  userId: string;
  username: string;
  profit: string;
}

export interface ChatMessageDTO {
  id: string;
  userId: string;
  username: string;
  text: string;
  createdAt: string;
}

export interface PresenceUpdate {
  onlineCount: number;
  users: Array<{ userId: string; username: string }>;
}
