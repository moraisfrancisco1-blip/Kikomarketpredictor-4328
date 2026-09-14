import { reliabilityBuckets, shrinkTowardBaseRate, type ThreeWaySample } from "./probability-validation";

export type FootballCalibrationReport = {
  sample: number;
  sufficient: boolean;
  brier: number | null;
  logLoss: number | null;
  baseRateHome: number;
  baseRateDraw: number;
  baseRateAway: number;
  maxWinnerProbability: number;
  shrinkApplied: boolean;
  homeReliability: ReturnType<typeof reliabilityBuckets>;
  drawReliability: ReturnType<typeof reliabilityBuckets>;
  awayReliability: ReturnType<typeof reliabilityBuckets>;
};

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
}

function baseRates(samples: ThreeWaySample[]) {
  if (!samples.length) return { home: 1 / 3, draw: 1 / 3, away: 1 / 3 };
  let h = 0, d = 0, a = 0;
  for (const s of samples) {
    if (s.outcome === 0) h++;
    else if (s.outcome === 1) d++;
    else a++;
  }
  return { home: h / samples.length, draw: d / samples.length, away: a / samples.length };
}

/**
 * Apply conservative empirical shrinkage to a 1X2 forecast.
 * This is calibration only; it does not introduce a new directional signal.
 */
export function calibrateFootballProbability(
  probability: { home: number; draw: number; away: number },
  validationSamples: ThreeWaySample[],
  priorStrength = 50,
) {
  const p = {
    home: clamp01(probability.home),
    draw: clamp01(probability.draw),
    away: clamp01(probability.away),
  };
  const total = p.home + p.draw + p.away || 1;
  const normalized = { home: p.home / total, draw: p.draw / total, away: p.away / total };
  const rates = baseRates(validationSamples);
  const n = validationSamples.length;
  return {
    home: shrinkTowardBaseRate(normalized.home, rates.home, n, priorStrength),
    draw: shrinkTowardBaseRate(normalized.draw, rates.draw, n, priorStrength),
    away: shrinkTowardBaseRate(normalized.away, rates.away, n, priorStrength),
  };
}

export function buildFootballCalibrationReport(samples: ThreeWaySample[], minimumSamples = 100): FootballCalibrationReport {
  const rates = baseRates(samples);
  const maxWinnerProbability = samples.reduce(
    (max, s) => Math.max(max, s.probHome, s.probDraw, s.probAway),
    0,
  );
  return {
    sample: samples.length,
    sufficient: samples.length >= minimumSamples,
    brier: samples.length ?
      samples.reduce((sum, s) => {
        const yH = s.outcome === 0 ? 1 : 0;
        const yD = s.outcome === 1 ? 1 : 0;
        const yA = s.outcome === 2 ? 1 : 0;
        return sum + (s.probHome - yH) ** 2 + (s.probDraw - yD) ** 2 + (s.probAway - yA) ** 2;
      }, 0) / samples.length : null,
    logLoss: null,
    baseRateHome: rates.home,
    baseRateDraw: rates.draw,
    baseRateAway: rates.away,
    maxWinnerProbability,
    shrinkApplied: samples.length < minimumSamples || maxWinnerProbability >= 0.85,
    homeReliability: reliabilityBuckets(samples, s => s.probHome, 0),
    drawReliability: reliabilityBuckets(samples, s => s.probDraw, 1),
    awayReliability: reliabilityBuckets(samples, s => s.probAway, 2),
  };
}
