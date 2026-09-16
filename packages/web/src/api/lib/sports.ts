export * from "./sports-legacy.js";

import { fetchFootball as fetchHistoricalFootball, FOOTBALL_LEAGUES } from "./sports-legacy.js";
import { predictFootballProduction } from "./football-production-engine.js";
import type { PredictExtOpts as LegacyPredictExtOpts } from "./sports-legacy.js";
import type { Match } from "./sports-legacy.js";
import type { FootballContextAdjustment } from "./football-model-contract.js";
import type { XGTeamStats } from "./sports-enrichment.js";
import { fetchExtraLeaguesPool, fetchContinentalHistoryMatches } from "./football-free-sources.js";

export type PredictExtOpts = LegacyPredictExtOpts & {
  fixtureDate?: string | Date;
  context?: FootballContextAdjustment;
  xg?: Map<string, XGTeamStats>;
};

// The legacy source intentionally keeps a fixed historical window. Production
// needs the current season as well, otherwise the model stops incorporating new
// results when a season rolls over. We load 2026/27 separately and merge it with
// the validated historical sample. Failed current-season fetches never erase the
// historical dataset.
const CURRENT_SEASON = "2627";
const currentSeasonCache = new Map<string, { ts: number; matches: Match[] }>();
const CURRENT_TTL = 15 * 60 * 1000;

function toIsoFootballDate(value: string): string {
  const parts = value.trim().split(/[\/\-]/);
  if (parts.length !== 3) return value.trim();
  let [dd, mm, yy] = parts;
  if (yy.length === 2) yy = (Number(yy) > 50 ? "19" : "20") + yy;
  return `${yy}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")}`;
}

async function fetchCurrentSeason(leagueCode: string): Promise<Match[]> {
  const cached = currentSeasonCache.get(leagueCode);
  if (cached && Date.now() - cached.ts < CURRENT_TTL) return cached.matches;

  try {
    const res = await fetch(`https://www.football-data.co.uk/mmz4281/${CURRENT_SEASON}/${leagueCode}.csv`, {
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return [];
    const text = await res.text();
    const lines = text.trim().split(/\r?\n/);
    if (!lines.length) return [];
    const header = lines[0].split(",");
    const iDate = header.indexOf("Date");
    const iHome = header.indexOf("HomeTeam");
    const iAway = header.indexOf("AwayTeam");
    const iHG = header.indexOf("FTHG");
    const iAG = header.indexOf("FTAG");
    if ([iDate, iHome, iAway, iHG, iAG].some((i) => i < 0)) return [];

    const matches: Match[] = [];
    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split(",");
      const home = cols[iHome]?.trim();
      const away = cols[iAway]?.trim();
      const hg = Number.parseInt(cols[iHG] ?? "", 10);
      const ag = Number.parseInt(cols[iAG] ?? "", 10);
      // Future fixtures have empty FTHG/FTAG and are intentionally excluded.
      if (!home || !away || !Number.isFinite(hg) || !Number.isFinite(ag)) continue;
      const date = toIsoFootballDate(cols[iDate] ?? "");
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
      matches.push({ date, home, away, hg, ag });
    }

    currentSeasonCache.set(leagueCode, { ts: Date.now(), matches });
    return matches;
  } catch {
    return [];
  }
}

export async function fetchFootball(leagueCode: string): Promise<Match[]> {
  const [historical, current] = await Promise.all([
    fetchHistoricalFootball(leagueCode),
    fetchCurrentSeason(leagueCode),
  ]);

  const merged = new Map<string, Match>();
  for (const match of [...historical, ...current]) {
    merged.set(`${match.date}|${match.home}|${match.away}`, match);
  }
  return [...merged.values()].sort((a, b) => a.date.localeCompare(b.date));
}

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

// ---- Cross-league (Champions League / Europa League / continental club
// competitions) production pool. Same current-season-merged, leakage-safe
// engine as domestic predictFootball — pooling all domestic leagues gives the
// Dixon-Coles fit enough matches per club to predict continental fixtures,
// since UEFA competitions have no standalone results feed of their own.
const CROSS_LEAGUE_TTL = 15 * 60 * 1000;
let _crossLeagueProduction: { ts: number; data: { matches: Match[]; teamLeague: Record<string, string> } } | null = null;

export async function fetchCrossLeagueDataProduction(): Promise<{ matches: Match[]; teamLeague: Record<string, string> }> {
  if (_crossLeagueProduction && Date.now() - _crossLeagueProduction.ts < CROSS_LEAGUE_TTL) return _crossLeagueProduction.data;

  const codes = Object.keys(FOOTBALL_LEAGUES);
  const [results, extra] = await Promise.all([
    Promise.allSettled(codes.map((code) => fetchFootball(code))),
    fetchExtraLeaguesPool(),
  ]);

  const merged = new Map<string, Match>();
  const teamLeague: Record<string, string> = {};
  results.forEach((r, i) => {
    if (r.status !== "fulfilled") return;
    const leagueName = FOOTBALL_LEAGUES[codes[i]]!.name;
    for (const m of r.value) {
      merged.set(`${m.date}|${m.home}|${m.away}`, m);
      teamLeague[m.home] = leagueName;
      teamLeague[m.away] = leagueName;
    }
  });
  // Extra leagues (see football-free-sources.ts) extend coverage for
  // Europa/Conference League entrants outside the 6 tracked domestic leagues.
  // A team already tracked domestically keeps its domestic league label.
  for (const m of extra.matches) merged.set(`${m.date}|${m.home}|${m.away}`, m);
  for (const [team, league] of Object.entries(extra.teamLeague)) {
    if (!teamLeague[team]) teamLeague[team] = league;
  }

  // Historical Champions/Europa League results bridge the leagues against
  // each other with real evidence (see fetchContinentalHistoryMatches) —
  // reconciled against every team name already known from the domestic +
  // extra-league pools built above, so a historical fixture connects to the
  // same node rather than creating a duplicate untethered one.
  const continental = await fetchContinentalHistoryMatches(Object.keys(teamLeague));
  for (const m of continental) merged.set(`${m.date}|${m.home}|${m.away}`, m);

  const data = { matches: [...merged.values()].sort((a, b) => a.date.localeCompare(b.date)), teamLeague };
  _crossLeagueProduction = { ts: Date.now(), data };
  return data;
}

/**
 * Leakage-safe replacement for the legacy predictCrossLeague: goes through
 * predictFootballProduction (chronological holdout validation + empirical
 * calibration shrinkage) instead of a bare Dixon-Coles fit, and pools the
 * current-season-merged match data so newly promoted/transferred teams and
 * this season's form are included.
 */
export async function predictCrossLeagueProduction(home: string, away: string, extOpts: PredictExtOpts = {}) {
  const fixtureDate = extOpts.fixtureDate ?? new Date().toISOString().slice(0, 10);
  const { matches, teamLeague } = await fetchCrossLeagueDataProduction();

  const prediction = predictFootballProduction(matches, home, away, {
    fixtureDate,
    neutral: extOpts.neutral,
    context: extOpts.context,
    xg: extOpts.xg,
  });

  return {
    ...prediction,
    leagueHome: teamLeague[home] ?? null,
    leagueAway: teamLeague[away] ?? null,
  };
}
