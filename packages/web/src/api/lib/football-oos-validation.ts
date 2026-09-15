import type { FootballMatch } from "./dixoncoles";
import { predictFootball } from "./sports";
import { multiclassBrier, multiclassLogLoss, type ThreeWaySample } from "./probability-validation";

export type FootballOosResult = {
  evaluated: number;
  brier: number | null;
  logLoss: number | null;
  accuracy: number | null;
  baselineBrier: number | null;
  baselineLogLoss: number | null;
  warnings: string[];
};

const outcomeOf = (m: FootballMatch): 0 | 1 | 2 => m.homeGoals > m.awayGoals ? 0 : m.homeGoals === m.awayGoals ? 1 : 2;

const baseline = (matches: FootballMatch[]): ThreeWaySample[] => {
  if (!matches.length) return [];
  const counts = [0, 0, 0];
  for (const m of matches) counts[outcomeOf(m)]++;
  const total = matches.length;
  const probs = counts.map((n) => n / total) as [number, number, number];
  return matches.map((m) => ({ probHome: probs[0], probDraw: probs[1], probAway: probs[2], outcome: outcomeOf(m) }));
};

export function evaluateFootballOos(league: string, matches: FootballMatch[], options: { minTrain?: number; minHoldout?: number } = {}): FootballOosResult {
  const minTrain = options.minTrain ?? 120;
  const minHoldout = options.minHoldout ?? 30;
  const ordered = [...matches].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  if (ordered.length < minTrain + minHoldout) return { evaluated: 0, brier: null, logLoss: null, accuracy: null, baselineBrier: null, baselineLogLoss: null, warnings: ["not enough chronological matches for OOS evaluation"] };

  const holdout = ordered.slice(-minHoldout);
  const training = ordered.slice(0, -minHoldout);
  const samples: ThreeWaySample[] = [];
  for (const fixture of holdout) {
    try {
      const p = predictFootball(league, training, fixture.home, fixture.away, { fixtureDate: fixture.date });
      samples.push({ probHome: p.probHome, probDraw: p.probDraw, probAway: p.probAway, outcome: outcomeOf(fixture) });
    } catch {
      // Fixtures without sufficient pre-fixture history are intentionally skipped.
    }
  }
  const base = baseline(holdout);
  const brier = multiclassBrier(samples), logLoss = multiclassLogLoss(samples);
  const baselineBrier = multiclassBrier(base), baselineLogLoss = multiclassLogLoss(base);
  let correct = 0;
  for (const s of samples) {
    const predicted = s.probHome >= s.probDraw && s.probHome >= s.probAway ? 0 : s.probDraw >= s.probAway ? 1 : 2;
    if (predicted === s.outcome) correct++;
  }
  const warnings: string[] = [];
  if (samples.length < minHoldout) warnings.push(`only ${samples.length} holdout predictions were evaluable`);
  if (brier != null && baselineBrier != null && brier >= baselineBrier) warnings.push("model Brier score does not beat the chronological baseline");
  if (logLoss != null && baselineLogLoss != null && logLoss >= baselineLogLoss) warnings.push("model Log Loss does not beat the chronological baseline");
  return { evaluated: samples.length, brier, logLoss, accuracy: samples.length ? correct / samples.length : null, baselineBrier, baselineLogLoss, warnings };
}
