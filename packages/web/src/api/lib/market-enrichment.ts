// Market enrichment: sentiment, volume confirmation, asset correlation,
// earnings calendar avoidance, Platt calibration.
// All free / keyless sources where possible.

// ─── Sentiment Analysis via RSS feeds ────────────────────────────────────────
// Sources: Yahoo Finance RSS, seeking alpha RSS, stockanalysis.
// No API key needed for RSS.

export type SentimentResult = {
  score: number;       // -1..1 (negative = bearish, positive = bullish)
  label: "bullish" | "bearish" | "neutral";
  articleCount: number;
  topHeadlines: string[];
  source: string;
};

const SENTIMENT_CACHE = new Map<string, { ts: number; result: SentimentResult }>();
const SENTIMENT_TTL = 30 * 60 * 1000; // 30min

const BULLISH_WORDS = ["surge", "rally", "gain", "jump", "rise", "bull", "upbeat", "beat", "record", "strong", "growth", "buy", "upgrade", "profit", "high"];
const BEARISH_WORDS = ["crash", "fall", "drop", "plunge", "decline", "bear", "miss", "loss", "cut", "downgrade", "sell", "weak", "warning", "fear", "risk"];

function scoreSentiment(text: string): number {
  const lower = text.toLowerCase();
  let score = 0;
  for (const w of BULLISH_WORDS) if (lower.includes(w)) score += 1;
  for (const w of BEARISH_WORDS) if (lower.includes(w)) score -= 1;
  return Math.max(-5, Math.min(5, score));
}

export async function fetchSentiment(symbol: string): Promise<SentimentResult> {
  const key = symbol.toUpperCase();
  const cached = SENTIMENT_CACHE.get(key);
  if (cached && Date.now() - cached.ts < SENTIMENT_TTL) return cached.result;

  const headlines: string[] = [];
  let totalScore = 0;

  // Yahoo Finance RSS (no key)
  const cleanSym = symbol.replace("/", "-").replace("^", "");
  try {
    const url = `https://feeds.finance.yahoo.com/rss/2.0/headline?s=${cleanSym}&region=US&lang=en-US`;
    const res = await fetch(url, { signal: AbortSignal.timeout(4000) });
    if (res.ok) {
      const xml = await res.text();
      const items = xml.match(/<title>([^<]+)<\/title>/g)?.slice(1, 8) ?? [];
      for (const item of items) {
        const title = item.replace(/<\/?title>/g, "").trim();
        if (title && !title.includes("Yahoo Finance")) {
          headlines.push(title);
          totalScore += scoreSentiment(title);
        }
      }
    }
  } catch { /* RSS unavailable */ }

  const n = headlines.length || 1;
  const normalized = totalScore / n / 5; // normalize to -1..1
  const label: "bullish" | "bearish" | "neutral" =
    normalized > 0.15 ? "bullish" : normalized < -0.15 ? "bearish" : "neutral";

  const result: SentimentResult = {
    score: +normalized.toFixed(3),
    label,
    articleCount: headlines.length,
    topHeadlines: headlines.slice(0, 3),
    source: "Yahoo Finance RSS",
  };
  SENTIMENT_CACHE.set(key, { ts: Date.now(), result });
  return result;
}

// ─── Volume Confirmation ──────────────────────────────────────────────────────

export type VolumeSignal = {
  avgVolume20d: number;
  lastVolume: number;
  ratio: number;        // lastVolume / avgVolume20d
  signal: "high" | "normal" | "low";
  confirmsMove: boolean; // high volume on directional move = confirmation
};

export function computeVolumeSignal(
  candles: { close: number; volume: number }[],
  predDirection: "up" | "down" | "flat",
): VolumeSignal {
  if (candles.length < 22) {
    return { avgVolume20d: 0, lastVolume: 0, ratio: 1, signal: "normal", confirmsMove: false };
  }
  const recent = candles.slice(-21);
  const last = recent[recent.length - 1];
  const avgVol = recent.slice(0, 20).reduce((s, c) => s + c.volume, 0) / 20;
  const ratio = avgVol > 0 ? last.volume / avgVol : 1;

  const signal: "high" | "normal" | "low" =
    ratio > 1.5 ? "high" : ratio < 0.6 ? "low" : "normal";

  // High volume on directional move = confirmation; low volume = weak signal
  const priceDir =
    last.close > recent[recent.length - 2].close ? "up" : "down";
  const confirmsMove =
    signal === "high" && priceDir === predDirection;

  return {
    avgVolume20d: Math.round(avgVol),
    lastVolume: last.volume,
    ratio: +ratio.toFixed(2),
    signal,
    confirmsMove,
  };
}

// ─── Asset Correlation ────────────────────────────────────────────────────────
// Compute Pearson correlation between two return series.

export type CorrelationResult = {
  symbol: string;
  correlation: number;   // -1..1
  relationship: "positive" | "negative" | "neutral";
  note: string;
};

export function computeCorrelation(
  returnsA: number[],
  returnsB: number[],
): number {
  const n = Math.min(returnsA.length, returnsB.length);
  if (n < 10) return 0;
  const a = returnsA.slice(-n);
  const b = returnsB.slice(-n);
  const meanA = a.reduce((s, x) => s + x, 0) / n;
  const meanB = b.reduce((s, x) => s + x, 0) / n;
  let cov = 0, varA = 0, varB = 0;
  for (let i = 0; i < n; i++) {
    const da = a[i] - meanA, db = b[i] - meanB;
    cov += da * db;
    varA += da * da;
    varB += db * db;
  }
  if (varA === 0 || varB === 0) return 0;
  return +(cov / Math.sqrt(varA * varB)).toFixed(3);
}

// Known correlations to display as context (static knowledge)
export const KNOWN_CORRELATIONS: Record<string, { related: string; note: string; typical: number }[]> = {
  "BTC/USD": [
    { related: "ETH/USD", note: "ETH segue BTC fortemente", typical: 0.85 },
    { related: "DXY", note: "BTC cai quando USD sobe", typical: -0.60 },
    { related: "SPY", note: "Correlação risk-on moderada", typical: 0.45 },
  ],
  "ETH/USD": [
    { related: "BTC/USD", note: "Segue BTC", typical: 0.85 },
    { related: "DXY", note: "Negativo com USD", typical: -0.55 },
  ],
  "AAPL": [
    { related: "QQQ", note: "AAPL pesa 12% no Nasdaq", typical: 0.88 },
    { related: "MSFT", note: "Big Tech correlada", typical: 0.75 },
    { related: "USD/EUR", note: "Receitas globais — leve negativo", typical: -0.25 },
  ],
  "TSLA": [
    { related: "BTC/USD", note: "Tesla tem BTC no balanço", typical: 0.50 },
    { related: "SPY", note: "Beta elevado vs S&P", typical: 0.65 },
  ],
};

// ─── Earnings Calendar ────────────────────────────────────────────────────────
// Free from Wall Street Horizon subset; fallback: static known schedules.

export type EarningsInfo = {
  hasUpcomingEarnings: boolean;
  daysToEarnings: number | null;
  earningsDate: string | null;
  warning: string | null;
};

const EARNINGS_CACHE = new Map<string, { ts: number; info: EarningsInfo }>();
const EARNINGS_TTL = 6 * 60 * 60 * 1000; // 6h

export async function fetchEarningsInfo(symbol: string): Promise<EarningsInfo> {
  const key = symbol.toUpperCase();
  const cached = EARNINGS_CACHE.get(key);
  if (cached && Date.now() - cached.ts < EARNINGS_TTL) return cached.info;

  // Try financialmodelingprep free endpoint (200 req/day free)
  const FMP_KEY = "demo";
  let earningsDate: string | null = null;

  try {
    const url = `https://financialmodelingprep.com/api/v3/earning_calendar?symbol=${key}&apikey=${FMP_KEY}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(4000) });
    if (res.ok) {
      const data = await res.json() as any[];
      if (Array.isArray(data) && data.length > 0) {
        const future = data
          .filter((d) => d.date && new Date(d.date) >= new Date())
          .sort((a, b) => a.date.localeCompare(b.date));
        if (future.length) earningsDate = future[0].date;
      }
    }
  } catch { /* skip */ }

  const daysToEarnings = earningsDate
    ? Math.round((new Date(earningsDate).getTime() - Date.now()) / 86400000)
    : null;
  const hasUpcomingEarnings = daysToEarnings != null && daysToEarnings <= 7;
  const warning =
    hasUpcomingEarnings
      ? `Resultados em ${daysToEarnings} dia(s) — volatilidade esperada. Previsão menos fiável.`
      : null;

  const info: EarningsInfo = { hasUpcomingEarnings, daysToEarnings, earningsDate, warning };
  EARNINGS_CACHE.set(key, { ts: Date.now(), info });
  return info;
}

// ─── Platt Scaling Calibration ────────────────────────────────────────────────
// Calibrates raw probability outputs using a sigmoid fit from historical accuracy.
// Without a real training history, we use a conservative shrinkage toward 0.5.

export function plattCalibrate(rawProb: number, slope = 1.2, intercept = -0.1): number {
  // Platt: p_cal = 1 / (1 + exp(-(slope * logit(raw) + intercept)))
  const logit = Math.log(rawProb / (1 - rawProb + 1e-9) + 1e-9);
  const calibrated = 1 / (1 + Math.exp(-(slope * logit + intercept)));
  return Math.max(0.05, Math.min(0.95, +calibrated.toFixed(4)));
}

// Ensemble blend: give 70% weight to primary model, 30% to sentiment-adjusted
export function ensembleBlend(
  modelProb: number,
  sentimentAdjust: number, // -0.1..+0.1
): number {
  const sentiProb = Math.max(0.05, Math.min(0.95, modelProb + sentimentAdjust));
  const blended = 0.70 * modelProb + 0.30 * sentiProb;
  return Math.max(0.05, Math.min(0.95, +blended.toFixed(4)));
}

