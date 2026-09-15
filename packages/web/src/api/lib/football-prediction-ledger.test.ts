import { describe, expect, test } from "bun:test";
import { recordFootballPrediction, reportFootballLedger, resolveFootballPrediction } from "./football-prediction-ledger";

describe("football prediction ledger", () => {
  const base = { predictionId: "fixture-1", fixtureDate: "2026-09-20", recordedAt: "2026-09-19T12:00:00.000Z", home: "Alpha", away: "Beta", probHome: 0.5, probDraw: 0.3, probAway: 0.2 };
  test("accepts a valid pre-fixture prediction", () => expect(recordFootballPrediction(base)).toMatchObject(base));
  test("rejects predictions recorded after the fixture date", () => expect(() => recordFootballPrediction({ ...base, recordedAt: "2026-09-21T00:00:00.000Z" })).toThrow("prediction recorded after fixture date"));
  test("rejects invalid probability vectors", () => {
    expect(() => recordFootballPrediction({ ...base, probHome: 0.8 })).toThrow("prediction probabilities must be finite, non-negative, and sum to 1");
    expect(() => recordFootballPrediction({ ...base, probAway: -0.1 })).toThrow("prediction probabilities must be finite, non-negative, and sum to 1");
  });
  test("prevents conflicting outcome resolution", () => {
    const row = recordFootballPrediction(base);
    const resolved = resolveFootballPrediction(row, 0);
    expect(resolved.outcome).toBe(0);
    expect(() => resolveFootballPrediction(resolved, 2)).toThrow("prediction already resolved with another outcome");
    expect(resolveFootballPrediction(resolved, 0).outcome).toBe(0);
  });
  test("reports Brier, Log Loss and calibration diagnostics", () => {
    const rows = [
      resolveFootballPrediction(recordFootballPrediction(base), 0),
      resolveFootballPrediction(recordFootballPrediction({ ...base, predictionId: "fixture-2", probHome: 0.2, probDraw: 0.5, probAway: 0.3 }), 1),
      recordFootballPrediction({ ...base, predictionId: "fixture-3", probHome: 0.2, probDraw: 0.2, probAway: 0.6 }),
    ];
    const report = reportFootballLedger(rows, 2);
    expect(report.total).toBe(3);
    expect(report.resolved).toBe(2);
    expect(report.unresolved).toBe(1);
    expect(report.accuracy).toBe(1);
    expect(report.calibration).toBe("unresolved");
    expect(report.brier).not.toBeNull();
    expect(report.logLoss).not.toBeNull();
    expect(Number.isFinite(report.ece ?? NaN)).toBe(true);
    expect(Number.isFinite(report.mce ?? NaN)).toBe(true);
  });
});
