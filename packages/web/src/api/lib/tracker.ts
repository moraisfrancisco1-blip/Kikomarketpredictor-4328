// Prediction Tracker — localStorage-based persistence (client) + server-side summary
// Tracks: football, international, market predictions vs actual results.
// Zero external deps. Data stored as JSON in localStorage key "mp_tracker_v1".

export type PredictionKind = "football" | "international" | "market";

export type PredictionRecord = {
  id: string;            // uuid-ish: kind + timestamp
  kind: PredictionKind;
  createdAt: string;     // ISO date
  label: string;         // e.g. "Arsenal vs Chelsea" or "AAPL"
  
  // Prediction
  predictedOutcome: string;   // "home" | "draw" | "away" | "up" | "down" | "flat"
  confidence: number;         // 0..1
  probHome?: number;
  probDraw?: number;
  probAway?: number;
  probUp?: number;
  
  // Optional metadata
  league?: string;
  isFriendly?: boolean;
  
  // Resolution (filled in after the event)
  resolvedAt?: string;
  actualOutcome?: string;    // same enum as predictedOutcome
  correct?: boolean;
  notes?: string;
};

export type TrackerSummary = {
  total: number;
  resolved: number;
  pending: number;
  correct: number;
  accuracy: number;         // correct / resolved
  byKind: Record<PredictionKind, { total: number; correct: number; accuracy: number }>;
  byConfidence: {
    low: { total: number; correct: number; accuracy: number };    // conf < 0.4
    mid: { total: number; correct: number; accuracy: number };    // 0.4–0.6
    high: { total: number; correct: number; accuracy: number };   // > 0.6
  };
  calibration: { bucket: string; predicted: number; actual: number; n: number }[];
  recentPicks: PredictionRecord[];
};

// ─── Server helper: compute summary from records ─────────────────────────────
export function computeSummary(records: PredictionRecord[]): TrackerSummary {
  const resolved = records.filter(r => r.correct !== undefined);
  const correct = resolved.filter(r => r.correct);
  
  const byKind: any = {
    football: { total: 0, correct: 0, accuracy: 0 },
    international: { total: 0, correct: 0, accuracy: 0 },
    market: { total: 0, correct: 0, accuracy: 0 },
  };
  
  for (const r of records) {
    byKind[r.kind].total++;
    if (r.correct) byKind[r.kind].correct++;
  }
  for (const k of Object.keys(byKind)) {
    const b = byKind[k];
    b.accuracy = b.total > 0 ? +(b.correct / b.total * 100).toFixed(1) : 0;
  }
  
  // Confidence buckets
  const confBuckets = { low: {total:0,correct:0,accuracy:0}, mid: {total:0,correct:0,accuracy:0}, high: {total:0,correct:0,accuracy:0} };
  for (const r of resolved) {
    const b = r.confidence < 0.4 ? "low" : r.confidence < 0.6 ? "mid" : "high";
    confBuckets[b].total++;
    if (r.correct) confBuckets[b].correct++;
  }
  for (const b of ["low","mid","high"] as const) {
    const bk = confBuckets[b];
    bk.accuracy = bk.total > 0 ? +(bk.correct / bk.total * 100).toFixed(1) : 0;
  }
  
  // Calibration: group resolved records by confidence decile, compare predicted vs actual
  const deciles: Record<string, { sumConf: number; correct: number; n: number }> = {};
  for (let d = 0; d <= 9; d++) deciles[String(d)] = { sumConf: 0, correct: 0, n: 0 };
  for (const r of resolved) {
    const d = Math.min(9, Math.floor(r.confidence * 10));
    deciles[String(d)].sumConf += r.confidence;
    deciles[String(d)].n++;
    if (r.correct) deciles[String(d)].correct++;
  }
  const calibration = Object.entries(deciles)
    .filter(([,v]) => v.n > 0)
    .map(([d, v]) => ({
      bucket: `${d}0-${d}9%`,
      predicted: +(v.sumConf / v.n * 100).toFixed(1),
      actual: +(v.correct / v.n * 100).toFixed(1),
      n: v.n,
    }));
  
  return {
    total: records.length,
    resolved: resolved.length,
    pending: records.length - resolved.length,
    correct: correct.length,
    accuracy: resolved.length > 0 ? +(correct.length / resolved.length * 100).toFixed(1) : 0,
    byKind,
    byConfidence: confBuckets,
    calibration,
    recentPicks: records.slice(-20).reverse(),
  };
}

// ─── Confidence score for sports predictions ─────────────────────────────────
// Returns 0..1 based on: sample size, model separation, friendly penalty, form data quality
export function computeSportsConfidence(opts: {
  sample: number;
  probWinner: number;   // max(probHome, probDraw, probAway)
  isFriendly: boolean;
  formAvailable: boolean;
  gamesHome: number;
  gamesAway: number;
}): number {
  const { sample, probWinner, isFriendly, gamesHome, gamesAway } = opts;
  
  // Base: how much separation from 33% (three-way)
  const separation = Math.max(0, probWinner - 0.333);
  let score = separation * 2.5; // 0..~0.4
  
  // Sample quality: more data = more confidence
  const sampleScore = Math.min(1, sample / 800) * 0.25;
  score += sampleScore;
  
  // Individual team sample
  const minGames = Math.min(gamesHome, gamesAway);
  const teamScore = Math.min(1, minGames / 30) * 0.15;
  score += teamScore;
  
  // Friendly penalty: -30%
  if (isFriendly) score *= 0.7;
  
  // Cap at 0.80 — markets have humans pricing them already
  return Math.min(0.80, Math.max(0.05, +score.toFixed(3)));
}

// ─── Market regime detection ──────────────────────────────────────────────────
export type MarketRegime = {
  regime: "bull" | "bear" | "sideways";
  strength: "strong" | "moderate" | "weak";
  description: string;
  color: string;
  details: {
    sma20vsPrice: number;   // % price vs SMA20
    sma50vsPrice: number;   // % price vs SMA50
    rsi14: number;
    atr14Pct: number;       // ATR as % of price (volatility)
    trend20: number;        // % return over 20 days
  };
};

export function detectRegime(closes: number[], rsi14val: number, sma20val: number, sma50val: number): MarketRegime {
  const last = closes[closes.length - 1];
  const n = closes.length;
  
  const sma20Pct = (last - sma20val) / sma20val * 100;
  const sma50Pct = (last - sma50val) / sma50val * 100;
  const trend20 = n >= 20 ? (last - closes[n-20]) / closes[n-20] * 100 : 0;
  
  // ATR14
  let atr = 0;
  if (n >= 15) {
    for (let i = n-14; i < n; i++) {
      atr += Math.abs(closes[i] - closes[i-1]) / closes[i-1] * 100;
    }
    atr /= 14;
  }
  
  // Regime logic
  let regime: "bull" | "bear" | "sideways";
  let strength: "strong" | "moderate" | "weak";
  
  const bullish = (sma20Pct > 0 ? 1 : 0) + (sma50Pct > 0 ? 1 : 0) + (trend20 > 2 ? 1 : 0) + (rsi14val > 55 ? 1 : 0);
  const bearish = (sma20Pct < 0 ? 1 : 0) + (sma50Pct < 0 ? 1 : 0) + (trend20 < -2 ? 1 : 0) + (rsi14val < 45 ? 1 : 0);
  
  if (bullish >= 3) {
    regime = "bull";
    strength = bullish === 4 ? "strong" : "moderate";
  } else if (bearish >= 3) {
    regime = "bear";
    strength = bearish === 4 ? "strong" : "moderate";
  } else if (Math.abs(trend20) < 3 && atr < 1.5) {
    regime = "sideways";
    strength = "weak";
  } else {
    regime = bullish > bearish ? "bull" : "bear";
    strength = "weak";
  }
  
  const descriptions: Record<string, string> = {
    "bull-strong": "Tendência de alta forte — preço acima das duas MMs, momentum positivo, RSI elevado",
    "bull-moderate": "Tendência de alta moderada — sinais maioritariamente positivos",
    "bull-weak": "Ligeira pressão compradora — sinal fraco, precaução",
    "bear-strong": "Tendência de baixa forte — preço abaixo das duas MMs, momentum negativo",
    "bear-moderate": "Tendência de baixa moderada — sinais maioritariamente negativos",
    "bear-weak": "Ligeira pressão vendedora — sinal fraco",
    "sideways-weak": "Mercado lateral — sem tendência clara, alta incerteza",
  };
  
  const colors: Record<string, string> = {
    bull: "var(--mp-bull)",
    bear: "var(--mp-bear)",
    sideways: "var(--mp-amber)",
  };
  
  return {
    regime,
    strength,
    description: descriptions[`${regime}-${strength}`] ?? "",
    color: colors[regime],
    details: {
      sma20vsPrice: +sma20Pct.toFixed(2),
      sma50vsPrice: +sma50Pct.toFixed(2),
      rsi14: +rsi14val.toFixed(1),
      atr14Pct: +atr.toFixed(2),
      trend20: +trend20.toFixed(2),
    },
  };
}
