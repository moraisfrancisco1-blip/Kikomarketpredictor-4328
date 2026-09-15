import { describe, expect, test } from "bun:test";
import { isFiniteThreeWaySample, reliabilityBuckets, topProbabilityCalibration } from "./probability-validation";

const samples = [
  { probHome: 0.8, probDraw: 0.1, probAway: 0.1, outcome: 0 as const },
  { probHome: 0.7, probDraw: 0.2, probAway: 0.1, outcome: 0 as const },
  { probHome: 0.2, probDraw: 0.6, probAway: 0.2, outcome: 1 as const },
  { probHome: 0.1, probDraw: 0.2, probAway: 0.7, outcome: 2 as const },
];

describe("probability calibration", () => {
  test("returns reliability buckets without dropping samples", () => {
    const buckets = reliabilityBuckets(samples, (s) => s.probHome, 0);
    expect(buckets.reduce((n, b) => n + b.count, 0)).toBe(samples.length);
  });

  test("returns finite top-probability ECE and MCE", () => {
    const result = topProbabilityCalibration(samples);
    expect(Number.isFinite(result.ece ?? NaN)).toBe(true);
    expect(Number.isFinite(result.mce ?? NaN)).toBe(true);
    expect(result.buckets.reduce((n, b) => n + b.count, 0)).toBe(samples.length);
  });

  test("perfectly calibrated deterministic sample has zero error", () => {
    const result = topProbabilityCalibration([
      { probHome: 1, probDraw: 0, probAway: 0, outcome: 0 as const },
      { probHome: 0, probDraw: 1, probAway: 0, outcome: 1 as const },
      { probHome: 0, probDraw: 0, probAway: 1, outcome: 2 as const },
    ]);
    expect(result.ece).toBe(0);
    expect(result.mce).toBe(0);
  });

  test("rejects non-finite and non-positive probability vectors", () => {
    expect(isFiniteThreeWaySample({ probHome: Number.NaN, probDraw: 0.5, probAway: 0.5, outcome: 0 })).toBe(false);
    expect(isFiniteThreeWaySample({ probHome: Number.POSITIVE_INFINITY, probDraw: 0, probAway: 1, outcome: 2 })).toBe(false);
    expect(isFiniteThreeWaySample({ probHome: 0, probDraw: 0, probAway: 0, outcome: 1 })).toBe(false);
    expect(isFiniteThreeWaySample({ probHome: 0.5, probDraw: 0.3, probAway: 0.2, outcome: 0 })).toBe(true);
  });

  test("ignores invalid samples instead of crashing calibration", () => {
    const result = topProbabilityCalibration([
      ...samples,
      { probHome: Number.NaN, probDraw: 0.5, probAway: 0.5, outcome: 0 as const },
    ]);
    expect(result.buckets.reduce((n, b) => n + b.count, 0)).toBe(samples.length);
    expect(Number.isFinite(result.ece ?? NaN)).toBe(true);
  });
});
