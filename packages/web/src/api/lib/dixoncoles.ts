// Shared prediction core — a proper Dixon-Coles model.
// PURELY data-driven. NO bookmaker odds are ever used.
//
// Improvements over plain independent Poisson:
//  1. Recency weighting — exponential time-decay
//  2. League-calibrated home advantage
//  3. Dixon-Coles tau (rho) low-score correction
//  4. Rest / congestion adjustment
//  5. Walk-forward backtesting

export type DCMatch = { date: string; home: string; away: string; hg: number; ag: number; neutral?: boolean; weight?: number };
export type FittedModel = { att: Record<string, number>; def: Record<string, number>; homeAdv: number; rho: number; intercept: number; teams: string[]; games: Record<string, number>; lastDate: Record<string, string> };
function decayWeight(daysAgo: number, xi: number) { return Math.exp(-xi * daysAgo); }
export function halfLifeToXi(halfLifeDays: number) { return Math.log(2) / halfLifeDays; }
function dayDiff(a: string, b: string) { return Math.abs(new Date(a).getTime() - new Date(b).getTime()) / 86_400_000; }
function tau(x: number, y: number, lh: number, la: number, rho: number) { if (x === 0 && y === 0) return 1 - lh * la * rho; if (x === 0 && y === 1) return 1 + lh * rho; if (x === 1 && y === 0) return 1 + la * rho; if (x === 1 && y === 1) return 1 - rho; return 1; }
function poissonPmf(k: number, lambda: number) { let f = 1; for (let i = 2; i <= k; i++) f *= i; return (Math.exp(-lambda) * lambda ** k) / f; }

export function fitDixonColes(matches: DCMatch[], opts: { halfLifeDays?: number; iterations?: number } = {}): FittedModel {
  const halfLife = opts.halfLifeDays ?? 180, xi = halfLifeToXi(halfLife), iters = opts.iterations ?? 12;
  const sorted = [...matches].sort((a, b) => (a.date < b.date ? -1 : 1));
  const newest = sorted.length ? sorted[sorted.length - 1].date : new Date().toISOString();
  const teams = new Set<string>(); for (const m of sorted) { teams.add(m.home); teams.add(m.away); } const teamList = [...teams];
  const lastDate: Record<string, string> = {}, w: number[] = new Array(sorted.length); let totGoals = 0, totW = 0;
  for (let i = 0; i < sorted.length; i++) { const m = sorted[i], ww = decayWeight(dayDiff(newest, m.date), xi) * (m.weight ?? 1); w[i] = ww; totGoals += (m.hg + m.ag) * ww; totW += ww; lastDate[m.home] = m.date; lastDate[m.away] = m.date; }
  const intercept = Math.log(Math.max(0.2, totW ? totGoals / (2 * totW) : 1.3));
  const att: Record<string, number> = {}, def: Record<string, number> = {}, eff: Record<string, number> = {};
  for (const t of teamList) { att[t] = 0; def[t] = 0; eff[t] = 0; }
  for (let i = 0; i < sorted.length; i++) { eff[sorted[i].home] += w[i]; eff[sorted[i].away] += w[i]; }
  let homeAdv = 0.25;
  for (let it = 0; it < iters; it++) {
    const numA: Record<string, number> = {}, denA: Record<string, number> = {}, numD: Record<string, number> = {}, denD: Record<string, number> = {};
    for (const t of teamList) { numA[t] = 0; denA[t] = 0; numD[t] = 0; denD[t] = 0; }
    for (let i = 0; i < sorted.length; i++) { const m = sorted[i], neu = !!m.neutral; const fH = Math.exp(intercept + def[m.away] + (neu ? 0 : homeAdv)); numA[m.home] += w[i] * m.hg; denA[m.home] += w[i] * fH; numD[m.away] += w[i] * m.hg; denD[m.away] += w[i] * Math.exp(intercept + att[m.home] + (neu ? 0 : homeAdv)); const fA = Math.exp(intercept + def[m.home]); numA[m.away] += w[i] * m.ag; denA[m.away] += w[i] * fA; numD[m.home] += w[i] * m.ag; denD[m.home] += w[i] * Math.exp(intercept + att[m.away]); }
    for (const t of teamList) { if (denA[t] > 0) att[t] = Math.log(Math.max(1e-3, numA[t] / denA[t])); if (denD[t] > 0) def[t] = Math.log(Math.max(1e-3, numD[t] / denD[t])); }
    const meanAtt = teamList.reduce((s, t) => s + att[t], 0) / teamList.length, meanDef = teamList.reduce((s, t) => s + def[t], 0) / teamList.length;
    for (const t of teamList) { att[t] -= meanAtt; def[t] -= meanDef; }
    let nH = 0, dH = 0; for (let i = 0; i < sorted.length; i++) { const m = sorted[i]; if (m.neutral) continue; nH += w[i] * m.hg; dH += w[i] * Math.exp(intercept + att[m.home] + def[m.away]); } if (dH > 0) homeAdv = Math.log(Math.max(1e-3, nH / dH));
  }
  let bestRho = 0, bestLL = -Infinity;
  for (let r = -0.18; r <= 0.000001; r += 0.01) { let ll = 0; for (let i = 0; i < sorted.length; i++) { const m = sorted[i], neu = !!m.neutral, lh = Math.exp(intercept + att[m.home] + def[m.away] + (neu ? 0 : homeAdv)), la = Math.exp(intercept + att[m.away] + def[m.home]), t = tau(m.hg, m.ag, lh, la, r); if (t > 0) ll += w[i] * Math.log(t); } if (ll > bestLL) { bestLL = ll; bestRho = r; } }
  return { att, def, homeAdv, rho: bestRho, intercept, teams: teamList, games: eff, lastDate };
}

export type DCPrediction = { expHomeGoals: number; expAwayGoals: number; probHome: number; probDraw: number; probAway: number; over25: number; under25: number; bttsYes: number; topScores: { score: string; prob: number }[] };
export type PredictOpts = { neutral?: boolean; restHomeDays?: number; restAwayDays?: number; homeAttackMult?: number; homeDefMult?: number; awayAttackMult?: number; awayDefMult?: number; motivationFactor?: number };
export function predictMatch(model: FittedModel, home: string, away: string, opts: PredictOpts = {}): DCPrediction {
  const neu = !!opts.neutral, ah = model.att[home] ?? 0, dh = model.def[home] ?? 0, aa = model.att[away] ?? 0, da = model.def[away] ?? 0;
  let lh = Math.exp(model.intercept + ah + da + (neu ? 0 : model.homeAdv)), la = Math.exp(model.intercept + aa + dh);
  const restFactor = (days?: number) => days == null ? 1 : days < 3 ? 0.94 : days < 4 ? 0.97 : days > 9 ? 1.02 : 1;
  lh *= restFactor(opts.restHomeDays); la *= restFactor(opts.restAwayDays);
  if (opts.homeAttackMult != null) lh *= Math.max(0.3, Math.min(1.5, opts.homeAttackMult)); if (opts.awayDefMult != null) lh *= Math.max(0.3, Math.min(1.5, opts.awayDefMult)); if (opts.awayAttackMult != null) la *= Math.max(0.3, Math.min(1.5, opts.awayAttackMult)); if (opts.homeDefMult != null) la *= Math.max(0.3, Math.min(1.5, opts.homeDefMult));
  if (opts.motivationFactor != null) { const mf = Math.max(0.6, Math.min(1.4, opts.motivationFactor)); lh *= mf; la *= mf; }
  const MAX = 10; let pH = 0, pD = 0, pA = 0, over = 0, btts = 0; const scoreList: { score: string; prob: number }[] = [];
  for (let i = 0; i <= MAX; i++) for (let j = 0; j <= MAX; j++) { const p = poissonPmf(i, lh) * poissonPmf(j, la) * tau(i, j, lh, la, model.rho); if (i > j) pH += p; else if (i === j) pD += p; else pA += p; if (i + j > 2.5) over += p; if (i > 0 && j > 0) btts += p; scoreList.push({ score: `${i}-${j}`, prob: p }); }
  const norm = pH + pD + pA || 1; scoreList.sort((a, b) => b.prob - a.prob);
  return { expHomeGoals: +lh.toFixed(2), expAwayGoals: +la.toFixed(2), probHome: pH / norm, probDraw: pD / norm, probAway: pA / norm, over25: over / norm, under25: 1 - over / norm, bttsYes: btts / norm, topScores: scoreList.slice(0, 5).map(s => ({ score: s.score, prob: +(s.prob / norm).toFixed(4) })) };
}

export function restDays(model: FittedModel, team: string): number | undefined { return restDaysAt(model, team, new Date().toISOString()); }
export function restDaysAt(model: FittedModel, team: string, targetDate: string): number | undefined { const last = model.lastDate[team]; if (!last) return undefined; const targetMs = new Date(targetDate).getTime(), lastMs = new Date(last).getTime(); if (!Number.isFinite(targetMs) || !Number.isFinite(lastMs) || lastMs >= targetMs) return undefined; return Math.max(0, Math.round((targetMs - lastMs) / 86_400_000)); }

export type Backtest = { n: number; brier: number; logLoss: number; accuracy: number; baselineBrier: number; baselineLogLoss: number; refitEvery: number; testFrom: string };
export function backtest(matches: DCMatch[], opts: { halfLifeDays?: number; testFraction?: number; refitEvery?: number; minTrain?: number } = {}): Backtest {
  const sorted = [...matches].sort((a, b) => (a.date < b.date ? -1 : 1)), testFraction = opts.testFraction ?? 0.25, refitEvery = opts.refitEvery ?? 20, minTrain = opts.minTrain ?? 120;
  const startIdx = Math.max(minTrain, Math.floor(sorted.length * (1 - testFraction))); if (startIdx >= sorted.length - 1) return { n: 0, brier: 0, logLoss: 0, accuracy: 0, baselineBrier: 0, baselineLogLoss: 0, refitEvery, testFrom: sorted[startIdx]?.date ?? "" };
  let bh = 0, bd = 0, ba = 0; for (let i = 0; i < startIdx; i++) { const m = sorted[i]; if (m.hg > m.ag) bh++; else if (m.hg === m.ag) bd++; else ba++; } const bt = bh + bd + ba || 1, base = [bh / bt, bd / bt, ba / bt];
  let model = fitDixonColes(sorted.slice(0, startIdx), { halfLifeDays: opts.halfLifeDays }); let sinceFit = 0, brier = 0, logLoss = 0, correct = 0, baseBrier = 0, baseLogLoss = 0, n = 0;
  for (let i = startIdx; i < sorted.length; i++) { if (sinceFit >= refitEvery) { model = fitDixonColes(sorted.slice(0, i), { halfLifeDays: opts.halfLifeDays }); sinceFit = 0; } sinceFit++; const m = sorted[i]; if (model.att[m.home] == null || model.att[m.away] == null) continue; const pr = predictMatch(model, m.home, m.away, { neutral: m.neutral, restHomeDays: restDaysAt(model, m.home, m.date), restAwayDays: restDaysAt(model, m.away, m.date) }); const p = [pr.probHome, pr.probDraw, pr.probAway], outcome = m.hg > m.ag ? 0 : m.hg === m.ag ? 1 : 2, y = [0, 0, 0]; y[outcome] = 1; for (let k = 0; k < 3; k++) { brier += (p[k] - y[k]) ** 2; baseBrier += (base[k] - y[k]) ** 2; } logLoss += -Math.log(Math.max(1e-9, p[outcome])); baseLogLoss += -Math.log(Math.max(1e-9, base[outcome])); if (p.indexOf(Math.max(...p)) === outcome) correct++; n++; }
  return { n, brier: n ? +(brier / n).toFixed(4) : 0, logLoss: n ? +(logLoss / n).toFixed(4) : 0, accuracy: n ? +(correct / n).toFixed(4) : 0, baselineBrier: n ? +(baseBrier / n).toFixed(4) : 0, baselineLogLoss: n ? +(baseLogLoss / n).toFixed(4) : 0, refitEvery, testFrom: sorted[startIdx].date };
}

export type TuneResult = { halfLifeDays: number; logLoss: number; brier: number; candidates: { halfLifeDays: number; logLoss: number }[] };
/**
 * Hyperparameter selection is separated from the final holdout. The last
 * holdout slice is intentionally never used to choose the half-life.
 */
export function tuneHalfLife(matches: DCMatch[], candidates: number[] = [90, 135, 180, 270, 400], btOpts: { testFraction?: number; refitEvery?: number; tuningFraction?: number } = {}): TuneResult {
  const sorted = [...matches].sort((a, b) => (a.date < b.date ? -1 : 1));
  const tuningFraction = Math.min(0.9, Math.max(0.5, btOpts.tuningFraction ?? 0.8));
  const tuningEnd = Math.max(0, Math.floor(sorted.length * tuningFraction));
  const tuningSet = sorted.slice(0, tuningEnd);
  let best: TuneResult | null = null; const tried: { halfLifeDays: number; logLoss: number }[] = [];
  for (const hl of candidates) {
    const bt = backtest(tuningSet, { halfLifeDays: hl, testFraction: btOpts.testFraction ?? 0.25, refitEvery: btOpts.refitEvery ?? 30 });
    if (!bt.n) continue; tried.push({ halfLifeDays: hl, logLoss: bt.logLoss });
    if (!best || bt.logLoss < best.logLoss) best = { halfLifeDays: hl, logLoss: bt.logLoss, brier: bt.brier, candidates: tried };
  }
  if (best) best.candidates = tried;
  return best ?? { halfLifeDays: 180, logLoss: 0, brier: 0, candidates: tried };
}

export type OUResult = { line: number; over: number; under: number }[];
export function predictOU(lh: number, la: number, rho: number): OUResult { const MAX = 12, lines = [0.5, 1.5, 2.5, 3.5, 4.5], over: number[] = new Array(lines.length).fill(0); let total = 0; for (let i = 0; i <= MAX; i++) for (let j = 0; j <= MAX; j++) { const p = poissonPmf(i, lh) * poissonPmf(j, la) * tau(i, j, lh, la, rho); total += p; for (let k = 0; k < lines.length; k++) if (i + j > lines[k]) over[k] += p; } return lines.map((line, k) => ({ line, over: total > 0 ? +(over[k] / total).toFixed(4) : 0.5, under: total > 0 ? +(1 - over[k] / total).toFixed(4) : 0.5 })); }
export type HandicapResult = { line: number; homeCovers: number; awayCovers: number; push: number };
export function predictHandicap(lh: number, la: number, rho: number, line: number): HandicapResult { const MAX = 12; let homeCovers = 0, awayCovers = 0, push = 0, total = 0; for (let i = 0; i <= MAX; i++) for (let j = 0; j <= MAX; j++) { const p = poissonPmf(i, lh) * poissonPmf(j, la) * tau(i, j, lh, la, rho); total += p; const margin = (i - j) - line; if (margin > 0) homeCovers += p; else if (margin < 0) awayCovers += p; else push += p; } return { line, homeCovers: total > 0 ? +(homeCovers / total).toFixed(4) : 0, awayCovers: total > 0 ? +(awayCovers / total).toFixed(4) : 0, push: total > 0 ? +(push / total).toFixed(4) : 0 }; }
export type AccLeg = { home: string; draw: string; away: string; pick: "home" | "draw" | "away" };
export type AccResult = { combinedProb: number; fairDecimalOdds: number; legs: { pick: string; prob: number }[] };
export function predictAccumulator(legs: { prob: number; pick: string }[]): AccResult { let combined = 1; for (const leg of legs) combined *= leg.prob; return { combinedProb: +combined.toFixed(6), fairDecimalOdds: combined > 0 ? +(1 / combined).toFixed(2) : 0, legs: legs.map(l => ({ pick: l.pick, prob: +l.prob.toFixed(4) })) }; }
export type WFSample = { date: string; home: string; away: string; hg: number; ag: number; probHome: number; probDraw: number; probAway: number; eloHome: number; eloAway: number; outcome: 0 | 1 | 2 };
export function backtestWithSamples(matches: DCMatch[], opts: { halfLifeDays?: number; testFraction?: number; refitEvery?: number; minTrain?: number } = {}): WFSample[] { const sorted = [...matches].sort((a, b) => (a.date < b.date ? -1 : 1)), testFraction = opts.testFraction ?? 0.5, refitEvery = opts.refitEvery ?? 25, minTrain = opts.minTrain ?? 120, startIdx = Math.max(minTrain, Math.floor(sorted.length * (1 - testFraction))); if (startIdx >= sorted.length - 1) return []; const eloRating: Record<string, number> = {}; const K = 20; const getElo = (team: string) => eloRating[team] ?? 1500; const updateElo = (home: string, away: string, hg: number, ag: number) => { const eH = getElo(home), eA = getElo(away), expH = 1 / (1 + Math.pow(10, (eA - eH) / 400)), actH = hg > ag ? 1 : hg === ag ? 0.5 : 0; eloRating[home] = eH + K * (actH - expH); eloRating[away] = eA + K * ((1 - actH) - (1 - expH)); }; for (let i = 0; i < startIdx; i++) updateElo(sorted[i].home, sorted[i].away, sorted[i].hg, sorted[i].ag); let model = fitDixonColes(sorted.slice(0, startIdx), { halfLifeDays: opts.halfLifeDays }), sinceFit = 0; const samples: WFSample[] = []; for (let i = startIdx; i < sorted.length; i++) { if (sinceFit >= refitEvery) { model = fitDixonColes(sorted.slice(0, i), { halfLifeDays: opts.halfLifeDays }); sinceFit = 0; } sinceFit++; const m = sorted[i]; if (model.att[m.home] == null || model.att[m.away] == null) { updateElo(m.home, m.away, m.hg, m.ag); continue; } const pr = predictMatch(model, m.home, m.away, { neutral: m.neutral, restHomeDays: restDaysAt(model, m.home, m.date), restAwayDays: restDaysAt(model, m.away, m.date) }); const outcome: 0 | 1 | 2 = m.hg > m.ag ? 0 : m.hg === m.ag ? 1 : 2; samples.push({ date: m.date, home: m.home, away: m.away, hg: m.hg, ag: m.ag, probHome: +pr.probHome.toFixed(4), probDraw: +pr.probDraw.toFixed(4), probAway: +pr.probAway.toFixed(4), eloHome: Math.round(getElo(m.home)), eloAway: Math.round(getElo(m.away)), outcome }); updateElo(m.home, m.away, m.hg, m.ag); } return samples; }
