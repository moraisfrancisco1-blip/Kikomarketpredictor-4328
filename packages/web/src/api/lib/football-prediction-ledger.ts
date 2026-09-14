import { multiclassBrier, multiclassLogLoss, type ThreeWaySample } from "./probability-validation";

export type FootballPredictionLedgerRow = {
  predictionId: string;
  fixtureDate: string;
  recordedAt: string;
  home: string;
  away: string;
  probHome: number;
  probDraw: number;
  probAway: number;
  outcome?: 0 | 1 | 2;
};

export type FootballLedgerReport = {
  total: number;
  resolved: number;
  unresolved: number;
  brier: number | null;
  logLoss: number | null;
  accuracy: number | null;
  calibration: "not-enough-data" | "unresolved" | "measured";
  warnings: string[];
};

/**
 * Validate a prediction before it is persisted. The fixture date is also the
 * as-of boundary: a prediction recorded on a later calendar day is invalid
 * because it could have been created with post-fixture information.
 */
export function recordFootballPrediction(
  row: Omit<FootballPredictionLedgerRow, "recordedAt"> & { recordedAt?: string },
): FootballPredictionLedgerRow {
  const recordedAt = row.recordedAt ?? new Date().toISOString();
  const fixtureTs = new Date(row.fixtureDate).getTime();
  const recordedTs = new Date(recordedAt).getTime();
  if (!Number.isFinite(fixtureTs)) throw new Error("invalid fixture date");
  if (!Number.isFinite(recordedTs)) throw new Error("invalid recorded-at date");

  const fixtureDay = new Date(fixtureTs).toISOString().slice(0, 10);
  const recordedDay = new Date(recordedTs).toISOString().slice(0, 10);
  if (recordedDay > fixtureDay) {
    throw new Error("prediction recorded after fixture date");
  }

  if (!row.predictionId || !row.home || !row.away || row.home === row.away) {
    throw new Error("prediction identity is invalid");
  }

  const total = row.probHome + row.probDraw + row.probAway;
  if (
    ![row.probHome, row.probDraw, row.probAway].every(Number.isFinite) ||
    row.probHome < 0 ||
    row.probDraw < 0 ||
    row.probAway < 0 ||
    Math.abs(total - 1) > 1e-6
  ) {
    throw new Error("prediction probabilities must be finite, non-negative, and sum to 1");
  }

  return { ...row, recordedAt };
}

export function resolveFootballPrediction(
  row: FootballPredictionLedgerRow,
  outcome: 0 | 1 | 2,
): FootballPredictionLedgerRow {
  if (row.outcome != null && row.outcome !== outcome) {
    throw new Error("prediction already resolved with another outcome");
  }
  return { ...row, outcome };
}

export function reportFootballLedger(
  rows: FootballPredictionLedgerRow[],
  minimumResolved = 100,
): FootballLedgerReport {
  const resolved = rows
    .filter((r) => r.outcome != null)
    .map(
      (r): ThreeWaySample => ({
        probHome: r.probHome,
        probDraw: r.probDraw,
        probAway: r.probAway,
        outcome: r.outcome!,
      }),
    );

  let correct = 0;
  for (const r of resolved) {
    const winner =
      r.probHome >= r.probDraw && r.probHome >= r.probAway
        ? 0
        : r.probDraw >= r.probAway
          ? 1
          : 2;
    if (winner === r.outcome) correct++;
  }

  const warnings: string[] = [];
  if (resolved.length < minimumResolved) {
    warnings.push("not enough resolved predictions for reliable calibration");
  }
  const unresolved = rows.length - resolved.length;
  if (unresolved > 0) warnings.push(`${unresolved} predictions remain unresolved`);

  return {
    total: rows.length,
    resolved: resolved.length,
    unresolved,
    brier: multiclassBrier(resolved),
    logLoss: multiclassLogLoss(resolved),
    accuracy: resolved.length ? correct / resolved.length : null,
    calibration:
      resolved.length < minimumResolved
        ? "not-enough-data"
        : unresolved
          ? "unresolved"
          : "measured",
    warnings,
  };
}
