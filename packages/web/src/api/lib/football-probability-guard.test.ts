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

function clearlyBetterSamples(n: number): { model: ThreeWaySample[]; baseline: ThreeWaySample[] } {
  return {
    model: Array.from({ length: n }, (_, i) => ({
      probHome: 0.8,
      probDraw: 0.1,
      probAway: 0.1,
      // 80% of the 0.8-confidence predictions are correct, giving a calibrated test fixture.
      outcome: (i % 5 === 0 ? 2 : 0) as 0 | 1 | 2,
    })),
    baseline: Array.from({ length: n }, (_, i) => ({
      probHome: 1 / 3,
      probDraw: 1 / 3,
      probAway: 1 / 3,
      outcome: (i % 5 === 0 ? 2 : 0) as 0 | 1 | 2,
    })),
  };
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

  test("requires robust paired improvements for strong OOS", () => {
    const { model, baseline } = clearlyBetterSamples(120);
    const result = assessFootballProbabilities(model, baseline);
    expect(result.band).toBe("strong-oos");
    expect(result.brierDeltaUpper95).toBeLessThan(0);
    expect(result.logLossDeltaUpper95).toBeLessThan(0);
  });

  test("returns finite diagnostics", () => {
    const rows = samples(120, 0.4);
    const result = assessFootballProbabilities(rows, rows);
    expect(Number.isFinite(result.brier ?? NaN)).toBe(true);
    expect(Number.isFinite(result.logLoss ?? NaN)).toBe(true);
    expect(Number.isFinite(result.ece ?? NaN)).toBe(true);
    expect(Number.isFinite(result.brierDeltaUpper95 ?? NaN)).toBe(true);
    expect(Number.isFinite(result.logLossDeltaUpper95 ?? NaN)).toBe(true);
  });

  test("does not count invalid rows toward OOS evidence", () => {
    const valid = samples(99, 0.4);
    const invalid: ThreeWaySample = { probHome: Number.NaN, probDraw: 0.2, probAway: 0.8, outcome: 2 };
    const result = assessFootballProbabilities([...valid, invalid], [...valid, invalid]);
    expect(result.band).toBe("insufficient-data");
    expect(result.publishable).toBe(false);
  });
});
