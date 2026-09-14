import { multiclassBrier, multiclassLogLoss, type ThreeWaySample } from "./probability-validation";

export type FootballProbability = {
  home: number;
  draw: number;
  away: number;
};

export type AuditMatch = {
  date: string;
  home: string;
  away: string;
  probability: FootballProbability;
  sourceLastDate?: string;
};

export type FootballAudit = {
  samples: number;
  sufficient: boolean;
  normalizedSamples: number;
  futureDataViolations: number;
  invalidProbabilityRows: number;
  brier: number | null;
  logLoss: number | null;
  maxWinnerProbability: number;
  flags: string[];
};

const EPS = 1e-9;

function finiteProbability(p: FootballProbability): boolean {
  return [p.home, p.draw, p.away].every((v) => Number.isFinite(v) && v >= 0 && v <= 1);
}

function sumProbability(p: FootballProbability): number {
  return p.home + p.draw + p.away;
}

function normalized(p: FootballProbability): FootballProbability {
  const h = Math.max(0, p.home);
  const d = Math.max(0, p.draw);
  const a = Math.max(0, p.away);
  const s = h + d + a;
  return s > EPS ? { home: h / s, draw: d / s, away: a / s } : { home: 1 / 3, draw: 1 / 3, away: 1 / 3 };
}

/**
 * Audit only. This function never changes a production forecast.
 * It is intended for walk-forward samples and historical validation reports.
 */
export function auditFootballPredictions(
  rows: AuditMatch[],
  minimumSamples = 100,
): FootballAudit {
  let futureDataViolations = 0;
  let invalidProbabilityRows = 0;
  let normalizedSamples = 0;
  let maxWinnerProbability = 0;
  const samples: ThreeWaySample[] = [];

  for (const row of rows) {
    const p = row.probability;
    if (!finiteProbability(p) || Math.abs(sumProbability(p) - 1) > 1e-6) {
      invalidProbabilityRows++;
    } else {
      normalizedSamples++;
    }

    if (row.sourceLastDate) {
      const predictionMs = new Date(row.date).getTime();
      const sourceMs = new Date(row.sourceLastDate).getTime();
      if (Number.isFinite(predictionMs) && Number.isFinite(sourceMs) && sourceMs >= predictionMs) {
        futureDataViolations++;
      }
    }

    const q = normalized(p);
    maxWinnerProbability = Math.max(maxWinnerProbability, q.home, q.draw, q.away);
  }

  // Outcome fields are intentionally absent from AuditMatch: callers should
  // convert genuine walk-forward outcomes into ThreeWaySample before scoring.
  const flags: string[] = [];
  if (rows.length < minimumSamples) flags.push("insufficient validation sample");
  if (futureDataViolations > 0) flags.push("future-data leakage detected");
  if (invalidProbabilityRows > 0) flags.push("invalid probability rows detected");
  if (maxWinnerProbability >= 0.85) flags.push("extreme probability concentration");

  return {
    samples: rows.length,
    sufficient: rows.length >= minimumSamples,
    normalizedSamples,
    futureDataViolations,
    invalidProbabilityRows,
    brier: multiclassBrier(samples),
    logLoss: multiclassLogLoss(samples),
    maxWinnerProbability,
    flags,
  };
}

export function probabilityNeedsShrinkage(
  probability: FootballProbability,
  sample: number,
  minimumSample = 100,
): boolean {
  const p = normalized(probability);
  const maxP = Math.max(p.home, p.draw, p.away);
  return sample < minimumSample || maxP >= 0.85;
}
