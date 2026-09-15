import type { FootballMatch } from "./dixoncoles";
import { predictFootball } from "./sports";
import { multiclassBrier, multiclassLogLoss, topProbabilityCalibration, type ThreeWaySample } from "./probability-validation";

export type FootballOosResult = {
  evaluated: number;
  brier: number | null;
  logLoss: number | null;
  accuracy: number | null;
  baselineBrier: number | null;
  baselineLogLoss: number | null;
  calibrationEce: number | null;
  calibrationMce: number | null;
  warnings: string[];
};

const outcomeOf = (m: FootballMatch): 0 | 1 | 2 => m.homeGoals > m.awayGoals ? 0 : m.homeGoals === m.awayGoals ? 1 : 2;

function baseRate(history: FootballMatch[]): [number, number, number] {
  if (!history.length) return [1 / 3, 1 / 3, 1 / 3];
  const counts = [0, 0, 0];
  for (const m of history) counts[outcomeOf(m)]++;
  const total = history.length;
  return [counts[0] / total, counts[1] / total, counts[2] / total];
}

/**
 * Strict chronological OOS evaluation.
 * Every holdout fixture is predicted using only matches strictly before it.
 * The baseline is also computed from that pre-fixture history, never from
 * holdout outcomes, so evaluation cannot leak the answers into the baseline.
 */
export function evaluateFootballOos(league: string, matches: FootballMatch[], options: { minTrain?: number; minHoldout?: number } = {}): FootballOosResult {
  const minTrain = options.minTrain ?? 120;
  const minHoldout = options.minHoldout ?? 30;
  const ordered = [...matches].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  if (ordered.length < minTrain + minHoldout) return { evaluated: 0, brier: null, logLoss: null, accuracy: null, baselineBrier: null, baselineLogLoss: null, calibrationEce: null, calibrationMce: null, warnings: ["not enough chronological matches for OOS evaluation"] };

  const start = Math.max(minTrain, ordered.length - minHoldout);
  const samples: ThreeWaySample[] = [];
  const baselineSamples: ThreeWaySample[] = [];

  for (let i = start; i < ordered.length; i++) {
    const fixture = ordered[i];
    const history = ordered.slice(0, i);
    if (history.length < minTrain) continue;
    try {
      const p = predictFootball(league, history, fixture.home, fixture.away, { fixtureDate: fixture.date });
      samples.push({ probHome: p.probHome, probDraw: p.probDraw, probAway: p.probAway, outcome: outcomeOf(fixture) });
      const base = baseRate(history);
      baselineSamples.push({ probHome: base[0], probDraw: base[1], probAway: base[2], outcome: outcomeOf(fixture) });
    } catch {
      // Fixtures without sufficient pre-fixture history are intentionally skipped.
    }
  }

  const brier = multiclassBrier(samples), logLoss = multiclassLogLoss(samples);
  const baselineBrier = multiclassBrier(baselineSamples), baselineLogLoss = multiclassLogLoss(baselineSamples);
  const calibration = topProbabilityCalibration(samples);
  let correct = 0;
  for (const s of samples) {
    const predicted = s.probHome >= s.probDraw && s.probHome >= s.probAway ? 0 : s.probDraw >= s.probAway ? 1 : 2;
    if (predicted === s.outcome) correct++;
  }
  const warnings: string[] = [];
  if (samples.length < minHoldout) warnings.push(`only ${samples.length} holdout predictions were evaluable`);
  if (brier != null && baselineBrier != null && brier >= baselineBrier) warnings.push("model Brier score does not beat the chronological baseline");
  if (logLoss != null && baselineLogLoss != null && logLoss >= baselineLogLoss) warnings.push("model Log Loss does not beat the chronological baseline");
  if (calibration.ece != null && calibration.ece > 0.05) warnings.push("top-probability calibration error exceeds 5%");
  return { evaluated: samples.length, brier, logLoss, accuracy: samples.length ? correct / samples.length : null, baselineBrier, baselineLogLoss, calibrationEce: calibration.ece, calibrationMce: calibration.mce, warnings };
}
