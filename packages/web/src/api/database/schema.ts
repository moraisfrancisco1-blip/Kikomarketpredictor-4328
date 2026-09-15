import { integer, sqliteTable, text, real, uniqueIndex } from "drizzle-orm/sqlite-core";

export const footballPredictionLedger = sqliteTable(
  "football_prediction_ledger",
  {
    predictionId: text("prediction_id").primaryKey(),
    fixtureDate: text("fixture_date").notNull(),
    recordedAt: text("recorded_at").notNull(),
    home: text("home").notNull(),
    away: text("away").notNull(),
    probHome: real("prob_home").notNull(),
    probDraw: real("prob_draw").notNull(),
    probAway: real("prob_away").notNull(),
    outcome: integer("outcome"),
  },
  (table) => ({
    fixtureLookup: uniqueIndex("football_prediction_fixture_idx").on(table.fixtureDate, table.home, table.away, table.predictionId),
  }),
);
