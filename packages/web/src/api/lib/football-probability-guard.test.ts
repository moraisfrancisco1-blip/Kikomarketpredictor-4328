import { describe, expect, test } from "bun:test";
import { assessFootballProbabilities } from "./football-probability-guard";
import type { ThreeWaySample } from "./probability-validation";

function samples(n: number, p = 0.5): ThreeWaySample[] {
  return Array.from({ length: n }, (_, i) => ({
    probHome: p,
    probDraw: (1 - p) / 2,
    probAway: (1 - p) / 2,
    outcome: (i % 2 === 0 ? 0 : 1) as 0 | 1 | 2,
  }));
}

describe("football probability guard", () => {
  test("blocks insufficient OOS evidence", () => {
    const rows = samples(50);
    const result = assessFootballProbabilities(rows, rows);
    expect(result.band).toBe("insufficient-data");
    expect(result.publishable).toBe(false);
  });

  test("never treats a weak model as strong OOS", () => {
    const rows = samples(120);
    const result = assessFootballProbabilities(rows, rows);
    expect(result.band).not.toBe("strong-oos");
  });

  test("returns finite diagnostics", () => {
    const rows = samples(120, 0.4);
    const result = assessFootballProbabilities(rows, rows);
    expect(Number.isFinite(result.brier ?? NaN)).toBe(true);
    expect(Number.isFinite(result.logLoss ?? NaN)).toBe(true);
    expect(Number.isFinite(result.ece ?? NaN)).toBe(true);
  });
});
