import { describe, expect, it } from "vitest";
import { canCashout, canPlaceBet } from "../src/betRules.js";

describe("betting state machine", () => {
  it("allows bet only in WAITING", () => {
    expect(canPlaceBet("WAITING")).toBe(true);
    expect(canPlaceBet("RUNNING")).toBe(false);
    expect(canPlaceBet("CRASHED")).toBe(false);
  });

  it("allows cashout only in RUNNING", () => {
    expect(canCashout("RUNNING")).toBe(true);
    expect(canCashout("WAITING")).toBe(false);
    expect(canCashout("CRASHED")).toBe(false);
  });
});
