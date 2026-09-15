// Probability validation utilities.
// These functions are deliberately pure: they never create or alter predictions.
// Use them only on genuinely out-of-sample predictions.

export type ThreeWaySample = {
  probHome: number;
  probDraw: number;
  probAway: number;
  outcome: 0 | 1 | 2;
};

export type CalibrationBucket = {
  lower: number;
  upper: number;
  count: number;
  meanProbability: number;
  observedRate: number;
};

export type TopProbabilityCalibration = {
  ece: number | null;
  mce: number | null;
  buckets: CalibrationBucket[];
};

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

function normalize3(a: number, b: number, c: number): [number, number, number] {
  const x = Math.max(0, a);
  const y = Math.max(0, b);
  const z = Math.max(0, c);
  const sum = x + y + z;
  if (sum <= 0) return [1 / 3, 1 / 3, 1 / 3];
  return [x / sum, y / sum, z / sum];
}

/** Multiclass Brier score. Lower is better; 0 is perfect. */
export function multiclassBrier(samples: ThreeWaySample[]): number | null {
  if (!samples.length) return null;
  let total = 0;
  for (const s of samples) {
    const [h, d, a] = normalize3(s.probHome, s.probDraw, s.probAway);
    total += (h - (s.outcome === 0 ? 1 : 0)) ** 2;
    total += (d - (s.outcome === 1 ? 1 : 0)) ** 2;
    total += (a - (s.outcome === 2 ? 1 : 0)) ** 2;
  }
  return total / samples.length;
}

/** Multiclass logarithmic loss. Lower is better. */
export function multiclassLogLoss(samples: ThreeWaySample[]): number | null {
  if (!samples.length) return null;
  const EPS = 1e-15;
  let total = 0;
  for (const s of samples) {
    const [h, d, a] = normalize3(s.probHome, s.probDraw, s.probAway);
    const p = s.outcome === 0 ? h : s.outcome === 1 ? d : a;
    total -= Math.log(Math.max(EPS, p));
  }
  return total / samples.length;
}

/**
 * Reliability buckets for one selected class (for example home-win probability).
 * The observed rate is meaningful only with adequate sample size; callers should
 * avoid interpreting tiny buckets as evidence of model quality.
 */
export function reliabilityBuckets(
  samples: ThreeWaySample[],
  selector: (s: ThreeWaySample) => number,
  outcome: 0 | 1 | 2,
  bucketCount = 10,
): CalibrationBucket[] {
  const n = Math.max(2, Math.floor(bucketCount));
  const buckets = Array.from({ length: n }, (_, i) => ({
    lower: i / n,
    upper: (i + 1) / n,
    rows: [] as { p: number; hit: boolean }[],
  }));

  for (const s of samples) {
    const p = clamp01(selector(s));
    const index = Math.min(n - 1, Math.floor(p * n));
    buckets[index].rows.push({ p, hit: s.outcome === outcome });
  }

  return buckets.map((b) => ({
    lower: b.lower,
    upper: b.upper,
    count: b.rows.length,
    meanProbability: b.rows.length ? b.rows.reduce((sum, r) => sum + r.p, 0) / b.rows.length : 0,
    observedRate: b.rows.length ? b.rows.filter((r) => r.hit).length / b.rows.length : 0,
  }));
}

/**
 * Calibration of the probability attached to the model's most likely class.
 * ECE is the sample-weighted absolute gap between predicted confidence and
 * observed hit rate; MCE is the largest bucket gap.
 */
export function topProbabilityCalibration(samples: ThreeWaySample[], bucketCount = 10): TopProbabilityCalibration {
  if (!samples.length) return { ece: null, mce: null, buckets: [] };
  const n = Math.max(2, Math.floor(bucketCount));
  const buckets = Array.from({ length: n }, (_, i) => ({
    lower: i / n,
    upper: (i + 1) / n,
    rows: [] as { p: number; hit: boolean }[],
  }));
  for (const s of samples) {
    const probs = [clamp01(s.probHome), clamp01(s.probDraw), clamp01(s.probAway)];
    const index = probs[0] >= probs[1] && probs[0] >= probs[2] ? 0 : probs[1] >= probs[2] ? 1 : 2;
    const p = probs[index];
    buckets[Math.min(n - 1, Math.floor(p * n))].rows.push({ p, hit: s.outcome === index });
  }
  const normalized = buckets.map((b) => ({
    lower: b.lower,
    upper: b.upper,
    count: b.rows.length,
    meanProbability: b.rows.length ? b.rows.reduce((sum, r) => sum + r.p, 0) / b.rows.length : 0,
    observedRate: b.rows.length ? b.rows.filter((r) => r.hit).length / b.rows.length : 0,
  }));
  const total = samples.length;
  const gaps = normalized.filter((b) => b.count > 0).map((b) => Math.abs(b.meanProbability - b.observedRate));
  const ece = normalized.reduce((sum, b) => sum + (b.count / total) * Math.abs(b.meanProbability - b.observedRate), 0);
  return { ece, mce: gaps.length ? Math.max(...gaps) : null, buckets: normalized };
}

/**
 * Conservative probability shrinkage toward the base rate.
 * This is intentionally not a learned calibration model. It is useful when a
 * prediction sample is small and we want to avoid presenting overconfident
 * probabilities as if they were empirically established.
 */
export function shrinkTowardBaseRate(
  probability: number,
  baseRate: number,
  effectiveSample: number,
  priorStrength = 50,
): number {
  const p = clamp01(probability);
  const b = clamp01(baseRate);
  const n = Math.max(0, effectiveSample);
  const prior = Math.max(1, priorStrength);
  return clamp01((p * n + b * prior) / (n + prior));
}

/**
 * Summarize a walk-forward sample without touching the model's predictions.
 * `minimumSamples` prevents a small sample from being reported as reliable.
 */
export function validateThreeWay(
  samples: ThreeWaySample[],
  minimumSamples = 100,
): {
  sample: number;
  sufficientSample: boolean;
  brier: number | null;
  logLoss: number | null;
} {
  return {
    sample: samples.length,
    sufficientSample: samples.length >= minimumSamples,
    brier: multiclassBrier(samples),
    logLoss: multiclassLogLoss(samples),
  };
}
