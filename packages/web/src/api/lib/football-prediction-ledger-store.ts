import type { FootballPredictionLedgerRow } from "./football-prediction-ledger";

/**
 * Process-local bounded ledger. Persistence is deliberately isolated behind
 * this interface so a database can replace it without changing model code.
 */
const MAX_ROWS = 5000;
const rows = new Map<string, FootballPredictionLedgerRow>();

export function saveFootballPrediction(row: FootballPredictionLedgerRow): FootballPredictionLedgerRow {
  rows.set(row.predictionId, row);
  while (rows.size > MAX_ROWS) rows.delete(rows.keys().next().value!);
  return row;
}

export function getFootballPrediction(predictionId: string): FootballPredictionLedgerRow | null {
  return rows.get(predictionId) ?? null;
}

export function listFootballPredictions(): FootballPredictionLedgerRow[] {
  return [...rows.values()].sort((a, b) => a.fixtureDate.localeCompare(b.fixtureDate));
}

export function clearFootballPredictionStore(): void {
  rows.clear();
}
