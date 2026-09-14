import { describe, expect, test } from "bun:test";
import { predictFootballProduction, type ProductionFootballMatch } from "./football-production-engine";
import { multiclassBrier, multiclassLogLoss } from "./probability-validation";

function makeMatches(count = 140): ProductionFootballMatch[] {
  const teams = ["Alpha", "Beta", "Gamma", "Delta", "Epsilon", "Zeta", "Eta", "Theta"];
  const rows: ProductionFootballMatch[] = [];
  const start = Date.UTC(2024, 0, 1);
  for (let i = 0; i < count; i++) {
    const day = new Date(start + i * 86_400_000 * 2).toISOString().slice(0, 10);
    const home = teams[i % teams.length];
    const away = teams[(i + 3) % teams.length];
    rows.push({ date: day, home, away, hg: (i * 7 + 1) % 4, ag: (i * 11 + 2) % 3 });
  }
  return rows;
}

describe("production football engine", () => {
  test("rejects a fixture with fewer than 120 historical matches before its date", () => {
    const matches = makeMatches(140);
    expect(() => predictFootballProduction(matches, "Alpha", "Beta", { fixtureDate: "2024-01-01" })).toThrow(
      "not enough historical matches available before fixture date",
    );
  });

  test("uses only matches strictly before the fixture date", () => {
    const matches = makeMatches(140);
    const fixtureDate = "2024-07-01";
    const expectedSample = matches.filter((m) => new Date(m.date).getTime() < new Date(fixtureDate).getTime()).length;
    const prediction = predictFootballProduction(matches, "Alpha", "Beta", { fixtureDate });
    expect(prediction.sample).toBe(expectedSample);
    expect(prediction.fixtureDate).toBe("2024-07-01");
    expect(prediction.sample).toBeLessThan(matches.length);
  });

  test("is invariant to future matches after the fixture date", () => {
    const matches = makeMatches(160);
    const fixtureDate = "2024-07-01";
    const historical = matches.filter((m) => m.date < fixtureDate);
    const future = matches.filter((m) => m.date >= fixtureDate);
    expect(historical.length).toBeGreaterThanOrEqual(120);
    expect(future.length).toBeGreaterThan(0);

    const baseline = predictFootballProduction(matches, "Alpha", "Beta", { fixtureDate });
    const alteredFuture = future.map((m, i) => ({ ...m, hg: 8 + i, ag: 0 }));
    const withAlteredFuture = predictFootballProduction([...historical, ...alteredFuture], "Alpha", "Beta", { fixtureDate });

    expect(withAlteredFuture.sample).toBe(baseline.sample);
    expect(withAlteredFuture.probHome).toBeCloseTo(baseline.probHome, 10);
    expect(withAlteredFuture.probDraw).toBeCloseTo(baseline.probDraw, 10);
    expect(withAlteredFuture.probAway).toBeCloseTo(baseline.probAway, 10);
    expect(withAlteredFuture.expHomeGoals).toBeCloseTo(baseline.expHomeGoals, 10);
    expect(withAlteredFuture.expAwayGoals).toBeCloseTo(baseline.expAwayGoals, 10);
  });

  test("returns a valid normalized three-way probability", () => {
    const prediction = predictFootballProduction(makeMatches(160), "Alpha", "Beta", { fixtureDate: "2024-07-01" });
    expect(prediction.probHome).toBeGreaterThanOrEqual(0);
    expect(prediction.probDraw).toBeGreaterThanOrEqual(0);
    expect(prediction.probAway).toBeGreaterThanOrEqual(0);
    expect(prediction.probHome).toBeLessThanOrEqual(1);
    expect(prediction.probDraw).toBeLessThanOrEqual(1);
    expect(prediction.probAway).toBeLessThanOrEqual(1);
    expect(prediction.probHome + prediction.probDraw + prediction.probAway).toBeCloseTo(1, 10);
  });
});

describe("probability validation", () => {
  test("Brier and log loss remain finite for valid three-way samples", () => {
    const samples = [
      { probHome: 0.5, probDraw: 0.3, probAway: 0.2, outcome: 0 as const },
      { probHome: 0.2, probDraw: 0.5, probAway: 0.3, outcome: 1 as const },
      { probHome: 0.2, probDraw: 0.2, probAway: 0.6, outcome: 2 as const },
    ];
    expect(multiclassBrier(samples)).toBeGreaterThanOrEqual(0);
    expect(multiclassLogLoss(samples)).toBeGreaterThan(0);
    expect(Number.isFinite(multiclassBrier(samples) ?? NaN)).toBe(true);
    expect(Number.isFinite(multiclassLogLoss(samples) ?? NaN)).toBe(true);
  });
});
