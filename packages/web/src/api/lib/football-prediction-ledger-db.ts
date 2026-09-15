import { eq } from "drizzle-orm";
import { db } from "../database";
import { footballPredictionLedger } from "../database/schema";
import type { FootballPredictionLedgerRow } from "./football-prediction-ledger";

const fromDb = (row: typeof footballPredictionLedger.$inferSelect): FootballPredictionLedgerRow => ({
  predictionId: row.predictionId,
  fixtureDate: row.fixtureDate,
  recordedAt: row.recordedAt,
  home: row.home,
  away: row.away,
  probHome: row.probHome,
  probDraw: row.probDraw,
  probAway: row.probAway,
  outcome: row.outcome == null ? undefined : row.outcome as 0 | 1 | 2,
});

export async function saveFootballPredictionDb(row: FootballPredictionLedgerRow): Promise<FootballPredictionLedgerRow> {
  const saved = await db.insert(footballPredictionLedger).values({
    predictionId: row.predictionId,
    fixtureDate: row.fixtureDate,
    recordedAt: row.recordedAt,
    home: row.home,
    away: row.away,
    probHome: row.probHome,
    probDraw: row.probDraw,
    probAway: row.probAway,
    outcome: row.outcome,
  }).onConflictDoUpdate({
    target: footballPredictionLedger.predictionId,
    set: {
      fixtureDate: row.fixtureDate,
      recordedAt: row.recordedAt,
      home: row.home,
      away: row.away,
      probHome: row.probHome,
      probDraw: row.probDraw,
      probAway: row.probAway,
      outcome: row.outcome,
    },
  }).returning();
  return fromDb(saved[0]);
}

export async function getFootballPredictionDb(predictionId: string): Promise<FootballPredictionLedgerRow | null> {
  const rows = await db.select().from(footballPredictionLedger).where(eq(footballPredictionLedger.predictionId, predictionId)).limit(1);
  return rows[0] ? fromDb(rows[0]) : null;
}

export async function listFootballPredictionsDb(): Promise<FootballPredictionLedgerRow[]> {
  const rows = await db.select().from(footballPredictionLedger);
  return rows.map(fromDb).sort((a, b) => a.fixtureDate.localeCompare(b.fixtureDate));
}
