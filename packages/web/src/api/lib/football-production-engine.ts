import { fitDixonColes, predictMatch, predictOU, restDaysAt, tuneHalfLife, backtestWithSamples, type DCMatch } from "./dixoncoles.js";
import { computeFatigue, computeH2H, computeImportance, type XGTeamStats } from "./sports-enrichment.js";
import { computeSportsConfidence } from "./tracker.js";
import { clampFootballContextAdjustment, type FootballContextAdjustment } from "./football-model-contract.js";
import { normalizeFixtureDate } from "./football-time-context.js";
import { multiclassBrier, multiclassLogLoss, shrinkTowardBaseRate, type ThreeWaySample } from "./probability-validation.js";

export type ProductionFootballMatch = { date: string; home: string; away: string; hg: number; ag: number; neutral?: boolean };
export type ProductionFootballOptions = { fixtureDate: string | Date; neutral?: boolean; context?: FootballContextAdjustment; xg?: Map<string, XGTeamStats> };
export type ProductionFootballValidation = { sample: number; brier: number | null; logLoss: number | null; baselineBrier: number | null; baselineLogLoss: number | null; maxWinnerProbability: number; sufficient: boolean; warnings: string[] };
export type ProductionFootballPrediction = {
  home: string; away: string; fixtureDate: string; expHomeGoals: number; expAwayGoals: number;
  probHome: number; probDraw: number; probAway: number; over25: number; under25: number; bttsYes: number;
  topScores: { score: string; prob: number }[]; eloHome: number; eloAway: number; homeAdv: number; rho: number;
  halfLife: number; sample: number; ouLines: ReturnType<typeof predictOU>; formHome: string; formAway: string;
  confidence: number; restHomeDays?: number; restAwayDays?: number; fatigue: ReturnType<typeof computeFatigue>;
  h2h: ReturnType<typeof computeH2H>; importanceHome: ReturnType<typeof computeImportance>["home"];
  importanceAway: ReturnType<typeof computeImportance>["away"]; xgHome?: number; xgAway?: number; xgUsed: false;
  contextSourceCount: number; validation: ProductionFootballValidation; warnings: string[];
};

function asDC(matches: ProductionFootballMatch[]): DCMatch[] { return matches.map((m) => ({ date: m.date, home: m.home, away: m.away, hg: m.hg, ag: m.ag, neutral: m.neutral })); }
function normalize3(p: { home: number; draw: number; away: number }) { const h = Math.max(0, p.home), d = Math.max(0, p.draw), a = Math.max(0, p.away), s = h + d + a || 1; return { home: h / s, draw: d / s, away: a / s }; }
function buildElo(matches: ProductionFootballMatch[]) { const ratings: Record<string, number> = {}; const get = (team: string) => ratings[team] ?? 1500; for (const m of [...matches].sort((a, b) => a.date.localeCompare(b.date))) { const rh = get(m.home) + 65, ra = get(m.away), expected = 1 / (1 + 10 ** ((ra - rh) / 400)), actual = m.hg > m.ag ? 1 : m.hg === m.ag ? 0.5 : 0, gd = Math.abs(m.hg - m.ag), multiplier = gd <= 1 ? 1 : gd === 2 ? 1.5 : (11 + gd) / 8, delta = 20 * multiplier * (actual - expected); ratings[m.home] = get(m.home) + delta; ratings[m.away] = get(m.away) - delta; } return ratings; }
function teamForm(matches: ProductionFootballMatch[], team: string, n = 5): string { return [...matches].filter((m) => m.home === team || m.away === team).sort((a, b) => a.date.localeCompare(b.date)).slice(-n).map((m) => { if (m.hg === m.ag) return "D"; const teamHome = m.home === team; return teamHome ? (m.hg > m.ag ? "W" : "L") : (m.ag > m.hg ? "W" : "L"); }).join("") || "-"; }

function historicalBaseRate(matches: ProductionFootballMatch[]): [number, number, number] {
  if (!matches.length) return [1 / 3, 1 / 3, 1 / 3];
  let home = 0, draw = 0, away = 0;
  for (const m of matches) {
    if (m.hg > m.ag) home++;
    else if (m.hg === m.ag) draw++;
    else away++;
  }
  return [home / matches.length, draw / matches.length, away / matches.length];
}

function buildValidation(samples: NonNullable<ReturnType<typeof backtestWithSamples>>, baselineHistory: ProductionFootballMatch[], minimum = 100): ProductionFootballValidation {
  const rows: ThreeWaySample[] = samples.map((s) => ({ probHome: s.probHome, probDraw: s.probDraw, probAway: s.probAway, outcome: s.outcome }));
  // The baseline is estimated exclusively from data before the final holdout.
  // It therefore cannot use the outcomes being evaluated by this validation.
  const [homeRate, drawRate, awayRate] = historicalBaseRate(baselineHistory);
  const baselineRows = rows.map((s) => ({ probHome: homeRate, probDraw: drawRate, probAway: awayRate, outcome: s.outcome }));
  const brier = multiclassBrier(rows), logLoss = multiclassLogLoss(rows), baselineBrier = multiclassBrier(baselineRows), baselineLogLoss = multiclassLogLoss(baselineRows);
  const maxWinnerProbability = rows.reduce((m, s) => Math.max(m, s.probHome, s.probDraw, s.probAway), 0);
  const warnings: string[] = [];
  if (rows.length < minimum) warnings.push("insufficient out-of-sample validation sample");
  if (maxWinnerProbability >= 0.85) warnings.push("high probability concentration");
  if (brier != null && baselineBrier != null && brier >= baselineBrier) warnings.push("Brier does not beat chronological pre-holdout base-rate");
  if (logLoss != null && baselineLogLoss != null && logLoss >= baselineLogLoss) warnings.push("log loss does not beat chronological pre-holdout base-rate");
  return { sample: rows.length, brier, logLoss, baselineBrier, baselineLogLoss, maxWinnerProbability, sufficient: rows.length >= minimum, warnings };
}

function calibrateWithHistory(p: { home: number; draw: number; away: number }, samples: ThreeWaySample[]) {
  if (samples.length < 100) return normalize3(p);
  const base = { home: samples.filter((s) => s.outcome === 0).length / samples.length, draw: samples.filter((s) => s.outcome === 1).length / samples.length, away: samples.filter((s) => s.outcome === 2).length / samples.length };
  return normalize3({ home: shrinkTowardBaseRate(p.home, base.home, samples.length, 50), draw: shrinkTowardBaseRate(p.draw, base.draw, samples.length, 50), away: shrinkTowardBaseRate(p.away, base.away, samples.length, 50) });
}

// Fitting (half-life tuning + the Dixon-Coles fit itself) is the expensive
// part of a prediction — cost scales with both match count and team count
// (2 parameters per team). It depends only on the as-of match window, not on
// which two teams are being predicted, so every fixture sharing the same
// fixtureDate and history (the common case: a full round of matches, all
// predicted "as of today") was needlessly refitting from scratch per pair.
// The cross-league pool (Champions/Europa League predictions) made this
// concrete: fitting against it went from ~150 to ~500 teams, and a page of
// several fixtures was fitting that model over and over.
const fitCache = new Map<string, { ts: number; tuned: ReturnType<typeof tuneHalfLife>; model: ReturnType<typeof fitDixonColes> }>();
const FIT_CACHE_TTL = 30 * 60 * 1000;
function fitCached(dc: DCMatch[]) {
  const key = `${dc.length}:${dc[0]?.date}:${dc.at(-1)?.date}`;
  const cached = fitCache.get(key);
  if (cached && Date.now() - cached.ts < FIT_CACHE_TTL) return cached;
  const tuned = tuneHalfLife(dc, undefined, { tuningFraction: 0.6, refitEvery: 25 });
  const model = fitDixonColes(dc, { halfLifeDays: tuned.halfLifeDays });
  const entry = { ts: Date.now(), tuned, model };
  fitCache.set(key, entry);
  return entry;
}

const validationCache = new Map<string, { ts: number; samples: NonNullable<ReturnType<typeof backtestWithSamples>> }>();
const CACHE_TTL = 30 * 60 * 1000;
function getValidationSamples(matches: ProductionFootballMatch[], halfLife: number, testFraction: number) {
  const dc = asDC(matches);
  const key = `${dc.length}:${dc[0]?.date}:${dc.at(-1)?.date}:${halfLife}:${testFraction}`;
  const cached = validationCache.get(key);
  if (cached && Date.now() - cached.ts < CACHE_TTL) return cached.samples;
  const samples = backtestWithSamples(dc, { halfLifeDays: halfLife, testFraction, refitEvery: 25 });
  validationCache.set(key, { ts: Date.now(), samples });
  return samples;
}

/**
 * Production-safe football engine. The chronological validation design is:
 * 1) first 60% of the as-of history is used for hyperparameter selection;
 * 2) the next 20% is a calibration window;
 * 3) the final 20% is a sealed holdout used only for OOS measurement;
 * 4) no holdout outcome is used to tune or calibrate the live prediction.
 * xG is display-only until historical per-match xG has passed OOS validation.
 */
export function predictFootballProduction(matches: ProductionFootballMatch[], home: string, away: string, options: ProductionFootballOptions): ProductionFootballPrediction {
  if (!home || !away || home === away) throw new Error("distinct home and away teams are required");
  if (matches.length < 120) throw new Error("not enough historical matches for production prediction");
  const fixtureDate = normalizeFixtureDate(options.fixtureDate);
  const fixtureTs = new Date(fixtureDate).getTime();
  // Every match in `matches` is, by construction at every call site, an
  // already-played result (future/unplayed rows are filtered out before
  // this is called) — there is no possible match dated between "now" and
  // any future fixtureDate. So for a future fixture, capping the as-of
  // cutoff at "now" instead of the fixture's own (later) date produces the
  // *identical* asOfMatches set — same fit, same prediction, proven, not
  // approximated. What it buys: every future fixture on a page (which is
  // nearly all of them — Champions/Europa League fixtures span weeks) now
  // shares one fit-cache entry instead of one each. Confirmed live: without
  // this, an otherwise-identical fixture one month out cost ~56s in
  // production (full model refit against the ~500-team cross-league pool)
  // instead of the <1s a same-day fixture got from the warm cache.
  const asOfTs = Math.min(fixtureTs, Date.now());
  const asOfMatches = matches.filter((m) => { const matchTs = new Date(m.date).getTime(); return Number.isFinite(matchTs) && matchTs < asOfTs; });
  if (asOfMatches.length < 120) throw new Error("not enough historical matches available before fixture date");

  const dc = asDC(asOfMatches);
  const { tuned, model } = fitCached(dc);
  if (model.att[home] == null || model.att[away] == null) throw new Error("team not found in historical sample");

  const context = clampFootballContextAdjustment(options.context ?? {});
  const restHomeDays = restDaysAt(model, home, fixtureDate);
  const restAwayDays = restDaysAt(model, away, fixtureDate);
  const raw = predictMatch(model, home, away, { neutral: options.neutral, restHomeDays, restAwayDays, homeAttackMult: context.homeAttackMult, homeDefMult: context.homeDefMult, awayAttackMult: context.awayAttackMult, awayDefMult: context.awayDefMult, motivationFactor: context.motivationFactor });

  const calibrationEnd = Math.max(1, Math.floor(dc.length * 0.8));
  const calibrationSamples = getValidationSamples(asOfMatches.slice(0, calibrationEnd), tuned.halfLifeDays, 0.25).map((s) => ({ probHome: s.probHome, probDraw: s.probDraw, probAway: s.probAway, outcome: s.outcome }));
  const calibrated = calibrateWithHistory({ home: raw.probHome, draw: raw.probDraw, away: raw.probAway }, calibrationSamples);

  const holdoutSamples = getValidationSamples(asOfMatches, tuned.halfLifeDays, 0.2);
  const validation = buildValidation(holdoutSamples, asOfMatches.slice(0, calibrationEnd));
  const elo = buildElo(asOfMatches);
  const warnings = [...validation.warnings, ...(context.warnings ?? [])];
  const xgHome = options.xg?.get(home)?.xgFor;
  const xgAway = options.xg?.get(away)?.xgFor;
  if (options.xg && (xgHome == null || xgAway == null)) warnings.push("xG data incomplete; ignored");
  warnings.push("xG is display-only until historical out-of-sample xG validation is available");

  return {
    home, away, fixtureDate, expHomeGoals: raw.expHomeGoals, expAwayGoals: raw.expAwayGoals,
    probHome: calibrated.home, probDraw: calibrated.draw, probAway: calibrated.away,
    over25: raw.over25, under25: raw.under25, bttsYes: raw.bttsYes, topScores: raw.topScores,
    eloHome: Math.round(elo[home] ?? 1500), eloAway: Math.round(elo[away] ?? 1500), homeAdv: +Math.exp(model.homeAdv).toFixed(2),
    rho: +model.rho.toFixed(3), halfLife: tuned.halfLifeDays, sample: asOfMatches.length, ouLines: predictOU(raw.expHomeGoals, raw.expAwayGoals, model.rho),
    formHome: teamForm(asOfMatches, home), formAway: teamForm(asOfMatches, away),
    confidence: computeSportsConfidence({ sample: asOfMatches.length, probWinner: Math.max(calibrated.home, calibrated.draw, calibrated.away), isFriendly: false, formAvailable: true, gamesHome: asOfMatches.filter((m) => m.home === home || m.away === home).length, gamesAway: asOfMatches.filter((m) => m.home === away || m.away === away).length }),
    restHomeDays, restAwayDays, fatigue: computeFatigue(asOfMatches, home, away, fixtureDate.slice(0, 10)), h2h: computeH2H(asOfMatches, home, away),
    importanceHome: computeImportance(asOfMatches, home, away).home, importanceAway: computeImportance(asOfMatches, home, away).away,
    xgHome, xgAway, xgUsed: false, contextSourceCount: context.sourceCount ?? 0, validation, warnings: [...new Set(warnings)],
  };
}
