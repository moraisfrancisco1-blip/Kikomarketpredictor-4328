import type { ThreeWaySample } from "./probability-validation";
import { multiclassBrier, multiclassLogLoss, topProbabilityCalibration } from "./probability-validation";

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
};

export function assessFootballProbabilities(
  samples: ThreeWaySample[],
  baselineSamples: ThreeWaySample[],
  minimumSamples = 100,
): FootballProbabilityGuard {
  const maxProbability = samples.reduce((m, s) => Math.max(m, s.probHome, s.probDraw, s.probAway), 0);
  const brier = multiclassBrier(samples);
  const logLoss = multiclassLogLoss(samples);
  const baselineBrier = multiclassBrier(baselineSamples);
  const baselineLogLoss = multiclassLogLoss(baselineSamples);
  const ece = topProbabilityCalibration(samples).ece;

  if (samples.length < minimumSamples) {
    return { band: "insufficient-data", publishable: false, reason: "fewer than the minimum OOS sample", maxProbability, brier, logLoss, baselineBrier, baselineLogLoss, ece };
  }
  const beatsBrier = brier != null && baselineBrier != null && brier < baselineBrier;
  const beatsLogLoss = logLoss != null && baselineLogLoss != null && logLoss < baselineLogLoss;
  if (!beatsBrier && !beatsLogLoss) {
    return { band: "baseline-only", publishable: false, reason: "OOS metrics do not beat the chronological baseline", maxProbability, brier, logLoss, baselineBrier, baselineLogLoss, ece };
  }
  if (maxProbability >= 0.85 || (ece != null && ece > 0.05)) {
    return { band: "calibrated", publishable: true, reason: "model has OOS evidence but confidence concentration/calibration is limited", maxProbability, brier, logLoss, baselineBrier, baselineLogLoss, ece };
  }
  if (beatsBrier && beatsLogLoss) {
    return { band: "strong-oos", publishable: true, reason: "both Brier and Log Loss beat the chronological baseline", maxProbability, brier, logLoss, baselineBrier, baselineLogLoss, ece };
  }
  return { band: "calibrated", publishable: true, reason: "at least one primary OOS metric beats the chronological baseline", maxProbability, brier, logLoss, baselineBrier, baselineLogLoss, ece };
}
