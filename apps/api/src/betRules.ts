import type { GameStatus } from "./game.js";

export const canPlaceBet = (status: GameStatus) => status === "WAITING";

export const canCashout = (status: GameStatus) => status === "RUNNING";
