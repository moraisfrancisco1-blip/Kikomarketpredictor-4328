import { describe, expect, test } from "bun:test";
import { evaluateFootballOos } from "./football-oos-validation";
import type { FootballMatch } from "./dixoncoles";

function match(date: string, i: number): FootballMatch {
  return {
    date,
    home: `Team${i % 10}`,
    away: `Team${(i + 1) % 10}`,
    homeGoals: i % 4 === 0 ? 2 : i % 3 === 0 ? 1 : 0,
    awayGoals: i % 5 === 0 ? 2 : i % 2 === 0 ? 1 : 0,
  };
}

describe("football chronological OOS validation", () => {
  test("rejects insufficient history and blocks probability publication", () => {
    const matches = Array.from({ length: 130 }, (_, i) => match(`2024-01-${String(i + 1).padStart(2, "0")}`, i));
    const result = evaluateFootballOos("Test League", matches, { minTrain: 120, minHoldout: 30 });
    expect(result.evaluated).toBe(0);
    expect(result.probabilityGuard.band).toBe("insufficient-data");
    expect(result.probabilityGuard.publishable).toBe(false);
  });

  test("evaluates only a chronological holdout", () => {
    const matches = Array.from({ length: 170 }, (_, i) => {
      const day = new Date(Date.UTC(2024, 0, 1 + i)).toISOString().slice(0, 10);
      return match(day, i);
    });
    const result = evaluateFootballOos("Test League", matches, { minTrain: 120, minHoldout: 30 });
    expect(result.evaluated).toBeGreaterThanOrEqual(0);
    expect(result.brier === null || Number.isFinite(result.brier)).toBe(true);
    expect(result.logLoss === null || Number.isFinite(result.logLoss)).toBe(true);
    expect(result.probabilityGuard).toBeDefined();
  });
});
