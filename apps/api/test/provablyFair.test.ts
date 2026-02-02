import { describe, expect, it } from "vitest";
import { computeCrashPoint } from "../src/game.js";

describe("provably fair", () => {
  it("is deterministic with same inputs", () => {
    const c1 = computeCrashPoint("serverSeed", "clientSeed", 1, "round1");
    const c2 = computeCrashPoint("serverSeed", "clientSeed", 1, "round1");
    expect(c1).toBe(c2);
  });

  it("changes when nonce changes", () => {
    const c1 = computeCrashPoint("serverSeed", "clientSeed", 1, "round1");
    const c2 = computeCrashPoint("serverSeed", "clientSeed", 2, "round1");
    expect(c1).not.toBe(c2);
  });
});
