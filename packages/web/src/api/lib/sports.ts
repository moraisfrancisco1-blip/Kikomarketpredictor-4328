export * from "./sports-legacy";

import { predictFootballProduction, type ProductionFootballOptions } from "./football-production-engine";
import type { PredictExtOpts as LegacyPredictExtOpts } from "./sports-legacy";
import type { Match } from "./sports-legacy";
import type { FootballContextAdjustment } from "./football-model-contract";
import type { XGTeamStats } from "./sports-enrichment";

export type PredictExtOpts = LegacyPredictExtOpts & {
  fixtureDate?: string | Date;
  context?: FootballContextAdjustment;
  xg?: Map<string, XGTeamStats>;
};

/**
 * Compatibility facade. Existing consumers keep the same function name, but
 * the prediction path is now the leakage-safe production engine.
 * A fixture/as-of date is mandatory so callers cannot accidentally fit on
 * matches that occur after the prediction timestamp.
 */
export function predictFootball(
  leagueName: string,
  matches: Match[],
  home: string,
  away: string,
  extOpts: PredictExtOpts = {},
) {
  if (extOpts.fixtureDate == null) {
    throw new Error("fixture date required: predictions must provide an explicit as-of date");
  }

  const prediction = predictFootballProduction(matches, home, away, {
    fixtureDate: extOpts.fixtureDate,
    neutral: extOpts.neutral,
    context: extOpts.context,
    xg: extOpts.xg,
  });

  return {
    league: leagueName,
    home,
    away,
    expHomeGoals: prediction.expHomeGoals,
    expAwayGoals: prediction.expAwayGoals,
    probHome: prediction.probHome,
    probDraw: prediction.probDraw,
    probAway: prediction.probAway,
    over25: prediction.over25,
    under25: prediction.under25,
    bttsYes: prediction.bttsYes,
    topScores: prediction.topScores,
    eloHome: prediction.eloHome,
    eloAway: prediction.eloAway,
    homeAdv: prediction.homeAdv,
    rho: prediction.rho,
    halfLife: prediction.halfLife,
    sample: prediction.sample,
    ouLines: prediction.ouLines,
    formHome: prediction.formHome,
    formAway: prediction.formAway,
    confidence: prediction.confidence,
    isFriendly: false,
    h2h: prediction.h2h,
    fatigue: prediction.fatigue,
    importanceHome: prediction.importanceHome,
    importanceAway: prediction.importanceAway,
    xgHome: prediction.xgHome,
    xgAway: prediction.xgAway,
    validation: prediction.validation,
    fixtureDate: prediction.fixtureDate,
    restHomeDays: prediction.restHomeDays,
    restAwayDays: prediction.restAwayDays,
    xgUsed: prediction.xgUsed,
    contextSourceCount: prediction.contextSourceCount,
    warnings: prediction.warnings,
  };
}
