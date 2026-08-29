// Shared prediction core — a proper Dixon-Coles model.
// PURELY data-driven. NO bookmaker odds are ever used.
//
// Improvements over plain independent Poisson:
//  1. Recency weighting   — exponential time-decay (recent games matter more)
//  2. League-calibrated home advantage — estimated from the data, not fixed
//  3. Dixon-Coles tau (rho) — corrects low-score correlation (0-0,1-0,0-1,1-1)
//  4. Rest / congestion adjustment — days since each team's last match
//  5. Backtest harness     — Brier score, log-loss, accuracy vs real results

export type DCMatch = {
  date: string; // ISO-ish, sortable / Date-parsable
  home: string;
  away: string;
  hg: number;
  ag: number;
  neutral?: boolean; // no home advantage when true
  weight?: number; // optional extra weight (e.g. competitive > friendly)
};

export type FittedModel = {
  att: Record<string, number>; // log attack strength
  def: Record<string, number>; // log defense strength
  homeAdv: number; // log home advantage (0 contribution if neutral)
  rho: number; // Dixon-Coles low-score correlation
  intercept: number; // log base scoring rate
  teams: string[];
  games: Record<string, number>; // effective sample per team
  lastDate: Record<string, string>; // last match date per team (for rest calc)
};

// ---- time decay -------------------------------------------------------------
// xi controls half-life. weight = exp(-xi * daysAgo). Default ~ 6-month halflife.
function decayWeight(daysAgo: number, xi: number) {
  return Math.exp(-xi * daysAgo);
}
// Convert a desired half-life (in days) to xi.
export function halfLifeToXi(halfLifeDays: number) {
  return Math.log(2) / halfLifeDays;
}

function dayDiff(a: string, b: string) {
  const da = new Date(a).getTime();
  const db = new Date(b).getTime();
  return Math.abs(da - db) / 86_400_000;
}

// ---- Dixon-Coles tau (the low-score correction) -----------------------------
// Adjusts the independence assumption for 0-0,1-0,0-1,1-1 scorelines.
function tau(x: number, y: number, lh: number, la: number, rho: number) {
  if (x === 0 && y === 0) return 1 - lh * la * rho;
  if (x === 0 && y === 1) return 1 + lh * rho;
  if (x === 1 && y === 0) return 1 + la * rho;
  if (x === 1 && y === 1) return 1 - rho;
  return 1;
}

function poissonPmf(k: number, lambda: number) {
  let f = 1;
  for (let i = 2; i <= k; i++) f *= i;
  return (Math.exp(-lambda) * lambda ** k) / f;
}

// ---- Fit model via weighted Poisson regression (coordinate descent) ---------
// We fit log-attack/defense per team + a global home advantage, maximizing the
// time-weighted Poisson log-likelihood. rho is then fit on a small grid.
export function fitDixonColes(
  matches: DCMatch[],
  opts: { halfLifeDays?: number; iterations?: number } = {},
): FittedModel {
  const halfLife = opts.halfLifeDays ?? 180;
  const xi = halfLifeToXi(halfLife);
  const iters = opts.iterations ?? 12;

  const sorted = [...matches].sort((a, b) => (a.date < b.date ? -1 : 1));
  const newest = sorted.length ? sorted[sorted.length - 1].date : new Date().toISOString();

  const teams = new Set<string>();
  for (const m of sorted) {
    teams.add(m.home);
    teams.add(m.away);
  }
  const teamList = [...teams];

  // precompute per-match weight and store last date per team
  const lastDate: Record<string, string> = {};
  const w: number[] = new Array(sorted.length);
  let totGoals = 0;
  let totW = 0;
  for (let i = 0; i < sorted.length; i++) {
    const m = sorted[i];
    const ww = decayWeight(dayDiff(newest, m.date), xi) * (m.weight ?? 1);
    w[i] = ww;
    totGoals += (m.hg + m.ag) * ww;
    totW += ww;
    lastDate[m.home] = m.date;
    lastDate[m.away] = m.date;
  }
  const avgGoalsPerTeam = totW ? totGoals / (2 * totW) : 1.3;
  const intercept = Math.log(Math.max(0.2, avgGoalsPerTeam));

  // init params at 0 (strength 1.0)
  const att: Record<string, number> = {};
  const def: Record<string, number> = {};
  const eff: Record<string, number> = {};
  for (const t of teamList) {
    att[t] = 0;
    def[t] = 0;
    eff[t] = 0;
  }
  for (let i = 0; i < sorted.length; i++) {
    eff[sorted[i].home] += w[i];
    eff[sorted[i].away] += w[i];
  }
  let homeAdv = 0.25; // ~ exp(0.25)=1.28 typical league home lift

  // Coordinate ascent: for a Poisson with log-mean = intercept + att_o + def_d (+homeAdv),
  // the closed-form MLE for a single team param given others is:
  //   newAtt = log( sum_w goalsFor  /  sum_w expectedRate )
  const expRate = (oAtt: number, dDef: number, home: boolean, neutral: boolean) =>
    Math.exp(intercept + oAtt + dDef + (home && !neutral ? homeAdv : 0));

  for (let it = 0; it < iters; it++) {
    // attack update
    const numA: Record<string, number> = {};
    const denA: Record<string, number> = {};
    const numD: Record<string, number> = {};
    const denD: Record<string, number> = {};
    for (const t of teamList) {
      numA[t] = 0;
      denA[t] = 0;
      numD[t] = 0;
      denD[t] = 0;
    }
    for (let i = 0; i < sorted.length; i++) {
      const m = sorted[i];
      const neu = !!m.neutral;
      // home scores: rate = exp(intercept + att_home + def_away + homeAdv)
      const baseH = Math.exp(intercept + def[m.away] + (neu ? 0 : homeAdv));
      const baseA = Math.exp(intercept + def[m.home]);
      numA[m.home] += w[i] * m.hg;
      denA[m.home] += w[i] * baseH * Math.exp(att[m.home]) / Math.exp(att[m.home]); // placeholder
      // We instead accumulate exp(att) factored out below.
    }
    // Proper closed-form: newAtt_o = log( sumW goalsFor_o / sumW otherFactors )
    // Recompute cleanly:
    for (const t of teamList) {
      numA[t] = 0;
      denA[t] = 0;
      numD[t] = 0;
      denD[t] = 0;
    }
    for (let i = 0; i < sorted.length; i++) {
      const m = sorted[i];
      const neu = !!m.neutral;
      // home attack vs away defense
      const fH = Math.exp(intercept + def[m.away] + (neu ? 0 : homeAdv));
      numA[m.home] += w[i] * m.hg;
      denA[m.home] += w[i] * fH;
      numD[m.away] += w[i] * m.hg;
      denD[m.away] += w[i] * Math.exp(intercept + att[m.home] + (neu ? 0 : homeAdv));
      // away attack vs home defense
      const fA = Math.exp(intercept + def[m.home]);
      numA[m.away] += w[i] * m.ag;
      denA[m.away] += w[i] * fA;
      numD[m.home] += w[i] * m.ag;
      denD[m.home] += w[i] * Math.exp(intercept + att[m.away]);
    }
    for (const t of teamList) {
      if (denA[t] > 0) att[t] = Math.log(Math.max(1e-3, numA[t] / denA[t]));
      if (denD[t] > 0) def[t] = Math.log(Math.max(1e-3, numD[t] / denD[t]));
    }
    // center for identifiability
    const meanAtt = teamList.reduce((s, t) => s + att[t], 0) / teamList.length;
    const meanDef = teamList.reduce((s, t) => s + def[t], 0) / teamList.length;
    for (const t of teamList) {
      att[t] -= meanAtt;
      def[t] -= meanDef;
    }
    // home advantage update (closed form): log( sumW homeGoals / sumW expHomeNoAdv )
    let nH = 0;
    let dH = 0;
    for (let i = 0; i < sorted.length; i++) {
      const m = sorted[i];
      if (m.neutral) continue;
      nH += w[i] * m.hg;
      dH += w[i] * Math.exp(intercept + att[m.home] + def[m.away]);
    }
    if (dH > 0) homeAdv = Math.log(Math.max(1e-3, nH / dH));
  }

  // Fit rho on a small grid by maximizing weighted log-likelihood of low scores.
  let bestRho = 0;
  let bestLL = -Infinity;
  for (let r = -0.18; r <= 0.0; r += 0.01) {
    let ll = 0;
    for (let i = 0; i < sorted.length; i++) {
      const m = sorted[i];
      const neu = !!m.neutral;
      const lh = Math.exp(intercept + att[m.home] + def[m.away] + (neu ? 0 : homeAdv));
      const la = Math.exp(intercept + att[m.away] + def[m.home]);
      const t = tau(m.hg, m.ag, lh, la, r);
      if (t > 0) ll += w[i] * Math.log(t);
    }
    if (ll > bestLL) {
      bestLL = ll;
      bestRho = r;
    }
  }

  return {
    att,
    def,
    homeAdv,
    rho: bestRho,
    intercept,
    teams: teamList,
    games: eff,
    lastDate,
  };
}

// ---- Predict a single match -------------------------------------------------
export type DCPrediction = {
  expHomeGoals: number;
  expAwayGoals: number;
  probHome: number;
  probDraw: number;
  probAway: number;
  over25: number;
  under25: number;
  bttsYes: number;
  topScores: { score: string; prob: number }[];
};

export type PredictOpts = {
  neutral?: boolean;
  restHomeDays?: number;
  restAwayDays?: number;
  // Injury / suspension multipliers (1.0 = no change, 0.7 = -30% attack, etc.)
  homeAttackMult?: number;
  homeDefMult?: number;
  awayAttackMult?: number;
  awayDefMult?: number;
  // Motivation factor applied to both expected goals (0.7 = tight final, 1.1 = open game)
  motivationFactor?: number;
};

export function predictMatch(
  model: FittedModel,
  home: string,
  away: string,
  opts: PredictOpts = {},
): DCPrediction {
  const neu = !!opts.neutral;
  const ah = model.att[home] ?? 0;
  const dh = model.def[home] ?? 0;
  const aa = model.att[away] ?? 0;
  const da = model.def[away] ?? 0;

  let lh = Math.exp(model.intercept + ah + da + (neu ? 0 : model.homeAdv));
  let la = Math.exp(model.intercept + aa + dh);

  // Rest / congestion: a team coming off a very short rest (<4 days) gets a
  // small penalty; a well-rested team a tiny boost. Capped to keep it sane.
  const restFactor = (days?: number) => {
    if (days == null) return 1;
    if (days < 3) return 0.94;
    if (days < 4) return 0.97;
    if (days > 9) return 1.02;
    return 1;
  };
  lh *= restFactor(opts.restHomeDays);
  la *= restFactor(opts.restAwayDays);

  // Injury/suspension adjustments
  // homeAttackMult affects lh (home scoring), awayDefMult also affects lh (away conceding)
  // awayAttackMult affects la (away scoring), homeDefMult also affects la (home conceding)
  if (opts.homeAttackMult != null) lh *= Math.max(0.3, Math.min(1.5, opts.homeAttackMult));
  if (opts.awayDefMult != null) lh *= Math.max(0.3, Math.min(1.5, opts.awayDefMult));
  if (opts.awayAttackMult != null) la *= Math.max(0.3, Math.min(1.5, opts.awayAttackMult));
  if (opts.homeDefMult != null) la *= Math.max(0.3, Math.min(1.5, opts.homeDefMult));

  // Motivation: a high-stakes final compresses both lambdas (more defensive),
  // a friendly inflates them. Factor is applied to both symmetrically.
  if (opts.motivationFactor != null) {
    const mf = Math.max(0.6, Math.min(1.4, opts.motivationFactor));
    lh *= mf;
    la *= mf;
  }

  const MAX = 10;
  let pH = 0;
  let pD = 0;
  let pA = 0;
  let over = 0;
  let btts = 0;
  const scoreList: { score: string; prob: number }[] = [];
  for (let i = 0; i <= MAX; i++) {
    for (let j = 0; j <= MAX; j++) {
      const p = poissonPmf(i, lh) * poissonPmf(j, la) * tau(i, j, lh, la, model.rho);
      if (i > j) pH += p;
      else if (i === j) pD += p;
      else pA += p;
      if (i + j > 2.5) over += p;
      if (i > 0 && j > 0) btts += p;
      scoreList.push({ score: `${i}-${j}`, prob: p });
    }
  }
  const norm = pH + pD + pA || 1;
  scoreList.sort((a, b) => b.prob - a.prob);

  return {
    expHomeGoals: +lh.toFixed(2),
    expAwayGoals: +la.toFixed(2),
    probHome: pH / norm,
    probDraw: pD / norm,
    probAway: pA / norm,
    over25: over / norm,
    under25: 1 - over / norm,
    bttsYes: btts / norm,
    topScores: scoreList.slice(0, 5).map((s) => ({ score: s.score, prob: +(s.prob / norm).toFixed(4) })),
  };
}

// Days of rest for a team going into a hypothetical "today" match.
export function restDays(model: FittedModel, team: string): number | undefined {
  const last = model.lastDate[team];
  if (!last) return undefined;
  return Math.round(dayDiff(new Date().toISOString(), last));
}

// ---- Backtest ---------------------------------------------------------------
// Walk-forward: for each match in the test window, fit on everything BEFORE it
// (to avoid leakage) and score the 1X2 prediction. Returns Brier, log-loss,
// accuracy and a baseline for comparison. We refit periodically (not every
// single match) for speed.
export type Backtest = {
  n: number;
  brier: number; // lower is better (0..2 for 3-way)
  logLoss: number; // lower is better
  accuracy: number; // share of correct most-likely-outcome calls
  baselineBrier: number; // home/draw/away base-rate guess
  baselineLogLoss: number;
  refitEvery: number;
  testFrom: string;
};

export function backtest(
  matches: DCMatch[],
  opts: { halfLifeDays?: number; testFraction?: number; refitEvery?: number; minTrain?: number } = {},
): Backtest {
  const sorted = [...matches].sort((a, b) => (a.date < b.date ? -1 : 1));
  const testFraction = opts.testFraction ?? 0.25;
  const refitEvery = opts.refitEvery ?? 20;
  const minTrain = opts.minTrain ?? 120;

  const startIdx = Math.max(minTrain, Math.floor(sorted.length * (1 - testFraction)));
  if (startIdx >= sorted.length - 1) {
    return {
      n: 0,
      brier: 0,
      logLoss: 0,
      accuracy: 0,
      baselineBrier: 0,
      baselineLogLoss: 0,
      refitEvery,
      testFrom: sorted[startIdx]?.date ?? "",
    };
  }

  // base rates from the training portion for the baseline model
  let bh = 0;
  let bd = 0;
  let ba = 0;
  for (let i = 0; i < startIdx; i++) {
    const m = sorted[i];
    if (m.hg > m.ag) bh++;
    else if (m.hg === m.ag) bd++;
    else ba++;
  }
  const bt = bh + bd + ba || 1;
  const base = [bh / bt, bd / bt, ba / bt];

  let model = fitDixonColes(sorted.slice(0, startIdx), { halfLifeDays: opts.halfLifeDays });
  let sinceFit = 0;

  let brier = 0;
  let logLoss = 0;
  let correct = 0;
  let baseBrier = 0;
  let baseLogLoss = 0;
  let n = 0;

  for (let i = startIdx; i < sorted.length; i++) {
    if (sinceFit >= refitEvery) {
      model = fitDixonColes(sorted.slice(0, i), { halfLifeDays: opts.halfLifeDays });
      sinceFit = 0;
    }
    sinceFit++;
    const m = sorted[i];
    // skip matches with unseen teams
    if (model.att[m.home] == null || model.att[m.away] == null) continue;
    const pr = predictMatch(model, m.home, m.away, { neutral: m.neutral });
    const p = [pr.probHome, pr.probDraw, pr.probAway];
    const outcome = m.hg > m.ag ? 0 : m.hg === m.ag ? 1 : 2;
    const y = [0, 0, 0];
    y[outcome] = 1;
    // Brier = sum (p - y)^2
    for (let k = 0; k < 3; k++) {
      brier += (p[k] - y[k]) ** 2;
      baseBrier += (base[k] - y[k]) ** 2;
    }
    logLoss += -Math.log(Math.max(1e-9, p[outcome]));
    baseLogLoss += -Math.log(Math.max(1e-9, base[outcome]));
    const pred = p.indexOf(Math.max(...p));
    if (pred === outcome) correct++;
    n++;
  }

  return {
    n,
    brier: n ? +(brier / n).toFixed(4) : 0,
    logLoss: n ? +(logLoss / n).toFixed(4) : 0,
    accuracy: n ? +(correct / n).toFixed(4) : 0,
    baselineBrier: n ? +(baseBrier / n).toFixed(4) : 0,
    baselineLogLoss: n ? +(baseLogLoss / n).toFixed(4) : 0,
    refitEvery,
    testFrom: sorted[startIdx].date,
  };
}

// ---- Half-life auto-tuner ---------------------------------------------------
// Different leagues have different "memory": some are stable season-to-season,
// others churn fast. Instead of hard-coding a 180-day half-life, we backtest a
// few candidates and keep the one with the lowest out-of-sample log-loss. This
// is a measurable accuracy gain — the chosen value is validated, not guessed.
export type TuneResult = { halfLifeDays: number; logLoss: number; brier: number; candidates: { halfLifeDays: number; logLoss: number }[] };

export function tuneHalfLife(
  matches: DCMatch[],
  candidates: number[] = [90, 135, 180, 270, 400],
  btOpts: { testFraction?: number; refitEvery?: number } = {},
): TuneResult {
  let best: TuneResult | null = null;
  const tried: { halfLifeDays: number; logLoss: number }[] = [];
  for (const hl of candidates) {
    const bt = backtest(matches, {
      halfLifeDays: hl,
      testFraction: btOpts.testFraction ?? 0.3,
      refitEvery: btOpts.refitEvery ?? 30,
    });
    if (!bt.n) continue;
    tried.push({ halfLifeDays: hl, logLoss: bt.logLoss });
    if (!best || bt.logLoss < best.logLoss) {
      best = { halfLifeDays: hl, logLoss: bt.logLoss, brier: bt.brier, candidates: tried };
    }
  }
  if (best) best.candidates = tried;
  return best ?? { halfLifeDays: 180, logLoss: 0, brier: 0, candidates: tried };
}

// ---- Over/Under lines -------------------------------------------------------
// Returns probability that total goals > line for common lines (0.5, 1.5, 2.5, 3.5, 4.5)
export type OUResult = { line: number; over: number; under: number }[];

export function predictOU(lh: number, la: number, rho: number): OUResult {
  const MAX = 12;
  const lines = [0.5, 1.5, 2.5, 3.5, 4.5];
  const over: number[] = new Array(lines.length).fill(0);
  let total = 0;
  for (let i = 0; i <= MAX; i++) {
    for (let j = 0; j <= MAX; j++) {
      const p = poissonPmf(i, lh) * poissonPmf(j, la) * tau(i, j, lh, la, rho);
      total += p;
      const goals = i + j;
      for (let k = 0; k < lines.length; k++) {
        if (goals > lines[k]) over[k] += p;
      }
    }
  }
  return lines.map((line, k) => ({
    line,
    over: total > 0 ? +(over[k] / total).toFixed(4) : 0.5,
    under: total > 0 ? +(1 - over[k] / total).toFixed(4) : 0.5,
  }));
}

// ---- Asian Handicap ---------------------------------------------------------
// Shifts the goal distribution by the handicap line and computes cover probabilities.
// line > 0: home gives goals (favoured), line < 0: home receives goals.
// Push (dead heat on handicap) is returned separately; half-ball lines have no push.
export type HandicapResult = {
  line: number;
  homeCovers: number; // P(home net > 0 after handicap)
  awayCovers: number; // P(away net > 0)
  push: number;       // P(exact tie on handicap, = 0 for half-ball lines)
};

export function predictHandicap(lh: number, la: number, rho: number, line: number): HandicapResult {
  const MAX = 12;
  let homeCovers = 0;
  let awayCovers = 0;
  let push = 0;
  let total = 0;
  for (let i = 0; i <= MAX; i++) {
    for (let j = 0; j <= MAX; j++) {
      const p = poissonPmf(i, lh) * poissonPmf(j, la) * tau(i, j, lh, la, rho);
      total += p;
      // Adjusted margin: positive = home covers
      const margin = (i - j) - line;
      if (margin > 0) homeCovers += p;
      else if (margin < 0) awayCovers += p;
      else push += p;
    }
  }
  return {
    line,
    homeCovers: total > 0 ? +(homeCovers / total).toFixed(4) : 0,
    awayCovers: total > 0 ? +(awayCovers / total).toFixed(4) : 0,
    push: total > 0 ? +(push / total).toFixed(4) : 0,
  };
}

// ---- Accumulator (parlay) ---------------------------------------------------
// Multiply independent match probabilities; return combined prob + fair decimal odds.
export type AccLeg = { home: string; draw: string; away: string; pick: "home" | "draw" | "away" };
export type AccResult = {
  combinedProb: number;
  fairDecimalOdds: number;
  legs: { pick: string; prob: number }[];
};

export function predictAccumulator(legs: { prob: number; pick: string }[]): AccResult {
  let combined = 1;
  for (const leg of legs) combined *= leg.prob;
  return {
    combinedProb: +combined.toFixed(6),
    fairDecimalOdds: combined > 0 ? +(1 / combined).toFixed(2) : 0,
    legs: legs.map((l) => ({ pick: l.pick, prob: +l.prob.toFixed(4) })),
  };
}

// ---- Walk-forward training samples for XGBoost -----------------------------
// Returns per-match out-of-sample DC predictions to use as XGBoost training data.
// This avoids circular leakage: each match is predicted using only PRIOR data.
export type WFSample = {
  date: string;
  home: string;
  away: string;
  hg: number;
  ag: number;
  probHome: number;
  probDraw: number;
  probAway: number;
  eloHome: number; // simple ELO from matches up to that point
  eloAway: number;
  outcome: 0 | 1 | 2; // 0=home, 1=draw, 2=away
};

export function backtestWithSamples(
  matches: DCMatch[],
  opts: { halfLifeDays?: number; testFraction?: number; refitEvery?: number; minTrain?: number } = {},
): WFSample[] {
  const sorted = [...matches].sort((a, b) => (a.date < b.date ? -1 : 1));
  const testFraction = opts.testFraction ?? 0.5; // use last 50% as training samples
  const refitEvery = opts.refitEvery ?? 25;
  const minTrain = opts.minTrain ?? 120;

  const startIdx = Math.max(minTrain, Math.floor(sorted.length * (1 - testFraction)));
  if (startIdx >= sorted.length - 1) return [];

  // Build Elo table incrementally using only past data
  const eloRating: Record<string, number> = {};
  const K = 20;
  const getElo = (team: string) => eloRating[team] ?? 1500;
  const updateElo = (home: string, away: string, hg: number, ag: number) => {
    const eH = getElo(home); const eA = getElo(away);
    const expH = 1 / (1 + Math.pow(10, (eA - eH) / 400));
    const actH = hg > ag ? 1 : hg === ag ? 0.5 : 0;
    eloRating[home] = eH + K * (actH - expH);
    eloRating[away] = eA + K * ((1 - actH) - (1 - expH));
  };

  // Warm up Elo on the initial training slice
  for (let i = 0; i < startIdx; i++) {
    const m = sorted[i];
    updateElo(m.home, m.away, m.hg, m.ag);
  }

  let model = fitDixonColes(sorted.slice(0, startIdx), { halfLifeDays: opts.halfLifeDays });
  let sinceFit = 0;
  const samples: WFSample[] = [];

  for (let i = startIdx; i < sorted.length; i++) {
    if (sinceFit >= refitEvery) {
      model = fitDixonColes(sorted.slice(0, i), { halfLifeDays: opts.halfLifeDays });
      sinceFit = 0;
    }
    sinceFit++;
    const m = sorted[i];
    if (model.att[m.home] == null || model.att[m.away] == null) {
      updateElo(m.home, m.away, m.hg, m.ag);
      continue;
    }
    const pr = predictMatch(model, m.home, m.away, { neutral: m.neutral });
    const outcome: 0 | 1 | 2 = m.hg > m.ag ? 0 : m.hg === m.ag ? 1 : 2;
    samples.push({
      date: m.date,
      home: m.home,
      away: m.away,
      hg: m.hg,
      ag: m.ag,
      probHome: +pr.probHome.toFixed(4),
      probDraw: +pr.probDraw.toFixed(4),
      probAway: +pr.probAway.toFixed(4),
      eloHome: Math.round(getElo(m.home)),
      eloAway: Math.round(getElo(m.away)),
      outcome,
    });
    // Update Elo AFTER the prediction (no leakage)
    updateElo(m.home, m.away, m.hg, m.ag);
  }
  return samples;
}
