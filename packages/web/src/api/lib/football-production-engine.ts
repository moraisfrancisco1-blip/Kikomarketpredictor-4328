import { fitDixonColes, predictMatch, predictOU, restDaysAt, tuneHalfLife, backtest, backtestWithSamples, type DCMatch } from "./dixoncoles";
import { computeFatigue, computeH2H, computeImportance, type XGTeamStats } from "./sports-enrichment";
import { clampFootballContextAdjustment, type FootballContextAdjustment } from "./football-model-contract";
import { normalizeFixtureDate } from "./football-time-context";
import { multiclassBrier, multiclassLogLoss, reliabilityBuckets, shrinkTowardBaseRate, type ThreeWaySample } from "./probability-validation";

export type ProductionFootballMatch = {
  date: string;
  home: string;
  away: string;
  hg: number;
  ag: number;
  neutral?: boolean;
};

export type ProductionFootballOptions = {
  fixtureDate: string | Date;
  neutral?: boolean;
  context?: FootballContextAdjustment;
  xg?: Map<string, XGTeamStats>;
};

export type ProductionFootballValidation = {
  sample: number;
  brier: number | null;
  logLoss: number | null;
  baselineBrier: number | null;
  baselineLogLoss: number | null;
  maxWinnerProbability: number;
  sufficient: boolean;
  warnings: string[];
};

export type ProductionFootballPrediction = {
  home: string;
  away: string;
  fixtureDate: string;
  expHomeGoals: number;
  expAwayGoals: number;
  probHome: number;
  probDraw: number;
  probAway: number;
  over25: number;
  under25: number;
  bttsYes: number;
  topScores: { score: string; prob: number }[];
  halfLife: number;
  restHomeDays?: number;
  restAwayDays?: number;
  fatigue: ReturnType<typeof computeFatigue>;
  h2h: ReturnType<typeof computeH2H>;
  importanceHome: ReturnType<typeof computeImportance>["home"];
  importanceAway: ReturnType<typeof computeImportance>["away"];
  xgHome?: number;
  xgAway?: number;
  xgUsed: false;
  contextSourceCount: number;
  validation: ProductionFootballValidation;
  warnings: string[];
};

function asDC(matches: ProductionFootballMatch[]): DCMatch[] {
  return matches.map((m) => ({
    date: m.date,
    home: m.home,
    away: m.away,
    hg: m.hg,
    ag: m.ag,
    neutral: m.neutral,
  }));
}

function normalize3(p: { home: number; draw: number; away: number }) {
  const h = Math.max(0, p.home);
  const d = Math.max(0, p.draw);
  const a = Math.max(0, p.away);
  const s = h + d + a || 1;
  return { home: h / s, draw: d / s, away: a / s };
}

function buildValidation(samples: NonNullable<ReturnType<typeof backtestWithSamples>>, minimum = 100): ProductionFootballValidation {
  const rows: ThreeWaySample[] = samples.map((s) => ({
    probHome: s.probHome,
    probDraw: s.probDraw,
    probAway: s.probAway,
    outcome: s.outcome,
  }));
  const homeRate = rows.length ? rows.filter((s) => s.outcome === 0).length / rows.length : 1 / 3;
  const drawRate = rows.length ? rows.filter((s) => s.outcome === 1).length / rows.length : 1 / 3;
  const awayRate = rows.length ? rows.filter((s) => s.outcome === 2).length / rows.length : 1 / 3;
  const brier = multiclassBrier(rows);
  const logLoss = multiclassLogLoss(rows);
  const baselineRows = rows.map((s) => ({ probHome: homeRate, probDraw: drawRate, probAway: awayRate, outcome: s.outcome }));
  const maxWinnerProbability = rows.reduce((m, s) => Math.max(m, s.probHome, s.probDraw, s.probAway), 0);
  const warnings: string[] = [];
  if (rows.length < minimum) warnings.push("insufficient out-of-sample validation sample");
  if (maxWinnerProbability >= 0.85) warnings.push("high probability concentration");
  if (brier != null && multiclassBrier(baselineRows) != null && brier >= multiclassBrier(baselineRows)!) warnings.push("Brier does not beat base-rate baseline");
  if (logLoss != null && multiclassLogLoss(baselineRows) != null && logLoss >= multiclassLogLoss(baselineRows)!) warnings.push("log loss does not beat base-rate baseline");
  return {
    sample: rows.length,
    brier,
    logLoss,
    baselineBrier: multiclassBrier(baselineRows),
    baselineLogLoss: multiclassLogLoss(baselineRows),
    maxWinnerProbability,
    sufficient: rows.length >= minimum,
    warnings,
  };
}

function calibrateWithHistory(p: { home: number; draw: number; away: number }, samples: ThreeWaySample[]) {
  if (samples.length < 100) return normalize3(p);
  const base = {
    home: samples.filter((s) => s.outcome === 0).length / samples.length,
    draw: samples.filter((s) => s.outcome === 1).length / samples.length,
    away: samples.filter((s) => s.outcome === 2).length / samples.length,
  };
  return normalize3({
    home: shrinkTowardBaseRate(p.home, base.home, samples.length, 50),
    draw: shrinkTowardBaseRate(p.draw, base.draw, samples.length, 50),
    away: shrinkTowardBaseRate(p.away, base.away, samples.length, 50),
  });
}

const validationCache = new Map<string, { ts: number; samples: NonNullable<ReturnType<typeof backtestWithSamples>> }>();
const CACHE_TTL = 30 * 60 * 1000;

function getValidationSamples(matches: ProductionFootballMatch[], halfLife: number) {
  const dc = asDC(matches);
  const key = `${dc.length}:${dc[0]?.date}:${dc.at(-1)?.date}:${halfLife}`;
  const cached = validationCache.get(key);
  if (cached && Date.now() - cached.ts < CACHE_TTL) return cached.samples;
  const samples = backtestWithSamples(dc, { halfLifeDays: halfLife, testFraction: 0.6, refitEvery: 25 });
  validationCache.set(key, { ts: Date.now(), samples });
  return samples;
}

/**
 * Production-safe football engine. Fixture date is mandatory so rest/fatigue
 * cannot accidentally depend on today's date. xG is exposed as context only;
 * it is not allowed into the probability forecast until a historical xG
 * dataset has been validated out-of-sample.
 */
export function predictFootballProduction(
  matches: ProductionFootballMatch[],
  home: string,
  away: string,
  options: ProductionFootballOptions,
): ProductionFootballPrediction {
  if (!home || !away || home === away) throw new Error("distinct home and away teams are required");
  if (matches.length < 120) throw new Error("not enough historical matches for production prediction");

  const fixtureDate = normalizeFixtureDate(options.fixtureDate);
  const dc = asDC(matches);
  const tuned = tuneHalfLife(dc);
  const model = fitDixonColes(dc, { halfLifeDays: tuned.halfLifeDays });
  if (model.att[home] == null || model.att[away] == null) throw new Error("team not found in historical sample");

  const context = clampFootballContextAdjustment(options.context ?? {});
  const restHomeDays = restDaysAt(model, home, fixtureDate);
  const restAwayDays = restDaysAt(model, away, fixtureDate);
  const raw = predictMatch(model, home, away, {
    neutral: options.neutral,
    restHomeDays,
    restAwayDays,
    homeAttackMult: context.homeAttackMult,
    homeDefMult: context.homeDefMult,
    awayAttackMult: context.awayAttackMult,
    awayDefMult: context.awayDefMult,
    motivationFactor: context.motivationFactor,
  });

  const validationSamples = getValidationSamples(matches, tuned.halfLifeDays).map((s) => ({
    probHome: s.probHome,
    probDraw: s.probDraw,
    probAway: s.probAway,
    outcome: s.outcome,
  }));
  const calibrated = calibrateWithHistory({ home: raw.probHome, draw: raw.probDraw, away: raw.probAway }, validationSamples);
  const validation = buildValidation(getValidationSamples(matches, tuned.halfLifeDays));

  const xgHome = options.xg?.get(home)?.xgFor;
  const xgAway = options.xg?.get(away)?.xgFor;
  const warnings = [...validation.warnings, ...(context.warnings ?? [])];
  if (options.xg && (xgHome == null || xgAway == null)) warnings.push("xG data incomplete; ignored");
  warnings.push("xG is display-only until historical out-of-sample xG validation is available");

  return {
    home,
    away,
    fixtureDate,
    expHomeGoals: raw.expHomeGoals,
    expAwayGoals: raw.expAwayGoals,
    probHome: calibrated.home,
    probDraw: calibrated.draw,
    probAway: calibrated.away,
    over25: raw.over25,
    under25: raw.under25,
    bttsYes: raw.bttsYes,
    topScores: raw.topScores,
    halfLife: tuned.halfLifeDays,
    restHomeDays,
    restAwayDays,
    fatigue: computeFatigue(matches, home, away, fixtureDate.slice(0, 10)),
    h2h: computeH2H(matches, home, away),
    importanceHome: computeImportance(matches, home, away).home,
    importanceAway: computeImportance(matches, home, away).away,
    xgHome,
    xgAway,
    xgUsed: false,
    contextSourceCount: context.sourceCount ?? 0,
    validation,
    warnings: [...new Set(warnings)],
  };
}
