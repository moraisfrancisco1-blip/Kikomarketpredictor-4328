import type { ThreeWaySample } from "./probability-validation";
import { isFiniteThreeWaySample, multiclassBrier, multiclassLogLoss, topProbabilityCalibration } from "./probability-validation";

export type FootballProbabilityBand = "insufficient-data" | "baseline-only" | "calibrated" | "strong-oos";

export type FootballProbabilityGuard = {
  band: FootballProbabilityBand;
  publishable: boolean;
  reason: string;
  maxProbability: number;
  brier: number | null;
  logLoss: number | null;
  baselineBrier: number | null;
  baselineLogLoss: number | null;
  ece: number | null;
  brierDelta: number | null;
  logLossDelta: number | null;
  brierDeltaUpper95: number | null;
  logLossDeltaUpper95: number | null;
};

type Metric = "brier" | "logLoss";

function loss(sample: ThreeWaySample, metric: Metric): number {
  const probabilities = [sample.probHome, sample.probDraw, sample.probAway];
  if (metric === "brier") {
    return probabilities.reduce((sum, probability, index) => sum + (probability - (index === sample.outcome ? 1 : 0)) ** 2, 0) / 3;
  }
  return -Math.log(Math.max(probabilities[sample.outcome], 1e-15));
}

function pairedDifferences(samples: ThreeWaySample[], baselineSamples: ThreeWaySample[], metric: Metric): number[] {
  const count = Math.min(samples.length, baselineSamples.length);
  const differences: number[] = [];
  for (let i = 0; i < count; i++) {
    const model = samples[i];
    const baseline = baselineSamples[i];
    if (!isFiniteThreeWaySample(model) || !isFiniteThreeWaySample(baseline) || model.outcome !== baseline.outcome) continue;
    const difference = loss(model, metric) - loss(baseline, metric);
    if (Number.isFinite(difference)) differences.push(difference);
  }
  return differences;
}

function percentile(sorted: number[], probability: number): number | null {
  if (!sorted.length) return null;
  const position = (sorted.length - 1) * probability;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
}

function bootstrapUpper95(differences: number[], iterations = 2000): number | null {
  if (differences.length < 2) return null;
  let state = 0x9e3779b9;
  const means: number[] = new Array(iterations);
  for (let iteration = 0; iteration < iterations; iteration++) {
    let sum = 0;
    for (let i = 0; i < differences.length; i++) {
      state ^= state << 13;
      state ^= state >>> 17;
      state ^= state << 5;
      const index = (state >>> 0) % differences.length;
      sum += differences[index];
    }
    means[iteration] = sum / differences.length;
  }
  means.sort((a, b) => a - b);
  return percentile(means, 0.975);
}

export function assessFootballProbabilities(
  samples: ThreeWaySample[],
  baselineSamples: ThreeWaySample[],
  minimumSamples = 100,
): FootballProbabilityGuard {
  // All diagnostics and thresholds operate on the same finite OOS population.
  // Invalid rows must not count toward the minimum sample requirement or distort calibration.
  const validSamples = samples.filter(isFiniteThreeWaySample);
  const validBaselineSamples = baselineSamples.filter(isFiniteThreeWaySample);
  const maxProbability = validSamples.reduce((m, s) => Math.max(m, s.probHome, s.probDraw, s.probAway), 0);
  const brier = multiclassBrier(validSamples);
  const logLoss = multiclassLogLoss(validSamples);
  const baselineBrier = multiclassBrier(validBaselineSamples);
  const baselineLogLoss = multiclassLogLoss(validBaselineSamples);
  const ece = topProbabilityCalibration(validSamples).ece;
  const brierDelta = brier != null && baselineBrier != null ? brier - baselineBrier : null;
  const logLossDelta = logLoss != null && baselineLogLoss != null ? logLoss - baselineLogLoss : null;
  const brierDeltaUpper95 = bootstrapUpper95(pairedDifferences(validSamples, validBaselineSamples, "brier"));
  const logLossDeltaUpper95 = bootstrapUpper95(pairedDifferences(validSamples, validBaselineSamples, "logLoss"));
  const diagnostics = { maxProbability, brier, logLoss, baselineBrier, baselineLogLoss, ece, brierDelta, logLossDelta, brierDeltaUpper95, logLossDeltaUpper95 };

  if (validSamples.length < minimumSamples) {
    return { band: "insufficient-data", publishable: false, reason: "fewer than the minimum finite OOS sample", ...diagnostics };
  }
  const beatsBrier = brierDelta != null && brierDelta < 0;
  const beatsLogLoss = logLossDelta != null && logLossDelta < 0;
  if (!beatsBrier && !beatsLogLoss) {
    return { band: "baseline-only", publishable: false, reason: "OOS metrics do not beat the chronological baseline", ...diagnostics };
  }
  if (maxProbability >= 0.85 || (ece != null && ece > 0.05)) {
    return { band: "calibrated", publishable: true, reason: "model has OOS evidence but confidence concentration/calibration is limited", ...diagnostics };
  }
  const robustBrier = beatsBrier && brierDeltaUpper95 != null && brierDeltaUpper95 < 0;
  const robustLogLoss = beatsLogLoss && logLossDeltaUpper95 != null && logLossDeltaUpper95 < 0;
  if (robustBrier && robustLogLoss) {
    return { band: "strong-oos", publishable: true, reason: "both Brier and Log Loss robustly beat the chronological baseline", ...diagnostics };
  }
  return { band: "calibrated", publishable: true, reason: "OOS improvement is not robust enough to qualify as strong OOS", ...diagnostics };
}
