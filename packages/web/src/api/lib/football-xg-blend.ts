import { multiclassBrier, multiclassLogLoss, type ThreeWaySample } from "./probability-validation.js";

export type ThreeWayProbabilities = {
  home: number;
  draw: number;
  away: number;
};

export type XGBlendOptions = {
  xgWeight?: number;
  minimumXGSample?: number;
  minimumValidationSample?: number;
};

function normalize(p: ThreeWayProbabilities): ThreeWayProbabilities {
  const h = Math.max(0, Number.isFinite(p.home) ? p.home : 0);
  const d = Math.max(0, Number.isFinite(p.draw) ? p.draw : 0);
  const a = Math.max(0, Number.isFinite(p.away) ? p.away : 0);
  const sum = h + d + a;
  return sum > 0 ? { home: h / sum, draw: d / sum, away: a / sum } : { home: 1 / 3, draw: 1 / 3, away: 1 / 3 };
}

/**
 * Blend a statistical 1X2 forecast with an xG-derived forecast.
 *
 * This is intentionally conservative: xG is ignored when its sample is too
 * small, and its weight is capped. The function does not decide whether xG is
 * useful; that decision must come from genuinely out-of-sample validation.
 */
export function blendFootballXG(
  base: ThreeWayProbabilities,
  xg: ThreeWayProbabilities,
  xgSample: number,
  opts: XGBlendOptions = {},
): ThreeWayProbabilities {
  const minimumXGSample = Math.max(20, Math.floor(opts.minimumXGSample ?? 60));
  if (!Number.isFinite(xgSample) || xgSample < minimumXGSample) return normalize(base);

  const requested = Number.isFinite(opts.xgWeight ?? 0.15) ? opts.xgWeight ?? 0.15 : 0.15;
  const weight = Math.max(0, Math.min(0.20, requested));
  const b = normalize(base);
  const x = normalize(xg);
  return normalize({
    home: b.home * (1 - weight) + x.home * weight,
    draw: b.draw * (1 - weight) + x.draw * weight,
    away: b.away * (1 - weight) + x.away * weight,
  });
}

export type XGValidation = {
  sufficient: boolean;
  baseBrier: number | null;
  blendedBrier: number | null;
  baseLogLoss: number | null;
  blendedLogLoss: number | null;
  improvementBrier: number | null;
  improvementLogLoss: number | null;
};

/**
 * Compare base vs xG blend using only out-of-sample predictions.
 * Positive improvement means the blended model is better (lower loss).
 */
export function validateXGBlend(
  baseSamples: ThreeWaySample[],
  blendedSamples: ThreeWaySample[],
  minimumSamples = 100,
): XGValidation {
  const sufficient = baseSamples.length >= minimumSamples && blendedSamples.length >= minimumSamples;
  const baseBrier = multiclassBrier(baseSamples);
  const blendedBrier = multiclassBrier(blendedSamples);
  const baseLogLoss = multiclassLogLoss(baseSamples);
  const blendedLogLoss = multiclassLogLoss(blendedSamples);
  return {
    sufficient,
    baseBrier,
    blendedBrier,
    baseLogLoss,
    blendedLogLoss,
    improvementBrier: baseBrier != null && blendedBrier != null ? baseBrier - blendedBrier : null,
    improvementLogLoss: baseLogLoss != null && blendedLogLoss != null ? baseLogLoss - blendedLogLoss : null,
  };
}

/** Require both metrics to improve before accepting xG into production. */
export function shouldAcceptXG(validation: XGValidation, minimumImprovement = 0.005): boolean {
  return validation.sufficient
    && (validation.improvementBrier ?? -Infinity) >= minimumImprovement
    && (validation.improvementLogLoss ?? -Infinity) >= minimumImprovement;
}
