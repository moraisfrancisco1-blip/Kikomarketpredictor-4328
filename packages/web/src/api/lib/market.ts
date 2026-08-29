// Market data fetching + model logic.
import { detectRegime } from "./tracker";
import { plattCalibrate, computeVolumeSignal, KNOWN_CORRELATIONS } from "./market-enrichment";
export { fetchSentiment, fetchEarningsInfo, type SentimentResult, type EarningsInfo } from "./market-enrichment";
// Provider: Twelve Data (works with `demo` key for a handful of symbols,
// real key unlocks everything). Set TWELVE_DATA_API_KEY in .env.

export type Candle = {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

const TD_BASE = "https://api.twelvedata.com";
const AV_BASE = "https://www.alphavantage.co/query";

export function getApiKey() {
  return process.env.TWELVE_DATA_API_KEY || "demo";
}

export function getAlphaKey() {
  return process.env.ALPHA_VANTAGE_API_KEY || "";
}

// In-memory cache: avoids hammering the provider (free tier ~8 req/min).
// Daily candles barely change intraday, so a 5-min TTL is plenty.
const CACHE = new Map<string, { ts: number; candles: Candle[] }>();
const TTL = 5 * 60 * 1000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---- Alpha Vantage fallback ----
// AV uses different endpoints for stocks vs crypto and no "/" in symbols.
async function fetchFromAlpha(symbol: string): Promise<Candle[]> {
  const key = getAlphaKey();
  if (!key) throw new Error("no fallback key");

  const isCrypto = symbol.includes("/");
  let url: string;
  if (isCrypto) {
    const [from, to] = symbol.split("/");
    url = `${AV_BASE}?function=DIGITAL_CURRENCY_DAILY&symbol=${from}&market=${to}&apikey=${key}`;
  } else {
    // compact = last 100 daily bars; lighter on AV's tight free quota.
    url = `${AV_BASE}?function=TIME_SERIES_DAILY&symbol=${encodeURIComponent(
      symbol,
    )}&outputsize=compact&apikey=${key}`;
  }

  const res = await fetch(url);
  if (!res.ok) throw new Error(`fallback http ${res.status}`);
  const json: any = await res.json();
  if (json["Note"] || json["Information"]) throw new Error("fallback rate limited");

  const seriesKey = Object.keys(json).find((k) => k.includes("Time Series"));
  if (!seriesKey) throw new Error("fallback no data");
  const series = json[seriesKey];

  const candles: Candle[] = Object.entries(series)
    .map(([date, v]: [string, any]) => {
      // crypto keys are prefixed differently; pick the right ones
      const open = parseFloat(v["1. open"] ?? v["1a. open (USD)"] ?? v["1b. open (USD)"]);
      const high = parseFloat(v["2. high"] ?? v["2a. high (USD)"] ?? v["2b. high (USD)"]);
      const low = parseFloat(v["3. low"] ?? v["3a. low (USD)"] ?? v["3b. low (USD)"]);
      const close = parseFloat(v["4. close"] ?? v["4a. close (USD)"] ?? v["4b. close (USD)"]);
      const volume = parseFloat(v["5. volume"] ?? v["5. volume (USD)"] ?? "0");
      return { date, open, high, low, close, volume };
    })
    .filter((c) => !isNaN(c.close))
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(-400);

  if (candles.length === 0) throw new Error("fallback no usable data");
  return candles;
}

export async function fetchCandles(symbol: string, outputsize = 400): Promise<Candle[]> {
  const apikey = getApiKey();
  const key = `${symbol}`;
  const cached = CACHE.get(key);
  // Cache holds the max size (400); slice for smaller requests.
  if (cached && Date.now() - cached.ts < TTL && cached.candles.length >= outputsize) {
    return cached.candles.slice(-outputsize);
  }

  const url = `${TD_BASE}/time_series?symbol=${encodeURIComponent(
    symbol,
  )}&interval=1day&outputsize=400&apikey=${apikey}`;

  const tryFallback = async (reason: string): Promise<Candle[]> => {
    try {
      const candles = await fetchFromAlpha(symbol);
      CACHE.set(key, { ts: Date.now(), candles });
      return candles.slice(-outputsize);
    } catch {
      if (cached) return cached.candles.slice(-outputsize);
      throw new Error(reason);
    }
  };

  let res: Response;
  try {
    res = await fetch(url);
  } catch {
    return tryFallback("providers unreachable");
  }

  // Rate limited: back off once and retry, then fall back to Alpha Vantage.
  if (res.status === 429) {
    await sleep(1500);
    res = await fetch(url);
  }
  if (res.status === 429) {
    return tryFallback("rate limited — wait a few seconds and retry");
  }
  if (!res.ok) {
    return tryFallback(`provider http ${res.status}`);
  }

  const json: any = await res.json();
  if (json.status === "error") {
    return tryFallback(json.message || "provider error");
  }
  if (!Array.isArray(json.values)) {
    return tryFallback("no data for symbol");
  }
  // Twelve Data returns newest-first; reverse to oldest-first.
  const candles: Candle[] = json.values
    .map((v: any) => ({
      date: v.datetime,
      open: parseFloat(v.open),
      high: parseFloat(v.high),
      low: parseFloat(v.low),
      close: parseFloat(v.close),
      volume: parseFloat(v.volume ?? "0"),
    }))
    .reverse();
  CACHE.set(key, { ts: Date.now(), candles });
  return candles.slice(-outputsize);
}

// ---------- Indicators ----------

export function sma(values: number[], period: number): (number | null)[] {
  const out: (number | null)[] = [];
  for (let i = 0; i < values.length; i++) {
    if (i < period - 1) {
      out.push(null);
      continue;
    }
    let s = 0;
    for (let j = i - period + 1; j <= i; j++) s += values[j];
    out.push(s / period);
  }
  return out;
}

export function ema(values: number[], period: number): number[] {
  const k = 2 / (period + 1);
  const out: number[] = [];
  let prev = values[0];
  for (let i = 0; i < values.length; i++) {
    prev = i === 0 ? values[0] : values[i] * k + prev * (1 - k);
    out.push(prev);
  }
  return out;
}

export function rsi(values: number[], period = 14): (number | null)[] {
  const out: (number | null)[] = new Array(values.length).fill(null);
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= period; i++) {
    const ch = values[i] - values[i - 1];
    if (ch >= 0) gain += ch;
    else loss -= ch;
  }
  let avgGain = gain / period;
  let avgLoss = loss / period;
  out[period] = 100 - 100 / (1 + (avgLoss === 0 ? 100 : avgGain / avgLoss));
  for (let i = period + 1; i < values.length; i++) {
    const ch = values[i] - values[i - 1];
    const g = ch > 0 ? ch : 0;
    const l = ch < 0 ? -ch : 0;
    avgGain = (avgGain * (period - 1) + g) / period;
    avgLoss = (avgLoss * (period - 1) + l) / period;
    const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
    out[i] = 100 - 100 / (1 + rs);
  }
  return out;
}

function stddev(values: number[]): number {
  const m = values.reduce((a, b) => a + b, 0) / values.length;
  const v = values.reduce((a, b) => a + (b - m) ** 2, 0) / values.length;
  return Math.sqrt(v);
}

// ---------- Prediction ensemble ----------
// Combines momentum, trend (SMA cross), and mean-reversion (RSI) into a
// directional signal with an HONEST confidence estimate. This is NOT a
// guaranteed forecast — markets are near-random over short horizons.

export type Prediction = {
  symbol: string;
  lastClose: number;
  direction: "up" | "down" | "flat";
  probabilityUp: number; // 0..1
  probabilityUpCalibrated: number; // Platt-calibrated probability
  expectedReturnPct: number; // naive expected next-day return
  confidence: number; // 0..1, deliberately capped low
  signals: { name: string; value: string; vote: number }[];
  asOf: string;
  // Enrichment
  volumeSignal?: { signal: string; ratio: number; confirmsMove: boolean };
  correlations?: { related: string; note: string; typical: number }[];
  earningsWarning?: string | null;
  regime: {
    regime: "bull" | "bear" | "sideways";
    strength: "strong" | "moderate" | "weak";
    description: string;
    color: string;
    details: {
      sma20vsPrice: number;
      sma50vsPrice: number;
      rsi14: number;
      atr14Pct: number;
      trend20: number;
    };
  };
  confidenceExplained: {
    label: string;
    pct: number;
    breakdown: { factor: string; impact: string; note: string }[];
  };
};

export function predict(symbol: string, candles: Candle[]): Prediction {
  const closes = candles.map((c) => c.close);
  const n = closes.length;
  const last = closes[n - 1];
  const returns: number[] = [];
  for (let i = 1; i < n; i++) returns.push((closes[i] - closes[i - 1]) / closes[i - 1]);

  const sma20 = sma(closes, 20)[n - 1]!;
  const sma50 = sma(closes, 50)[n - 1]!;
  const rsi14 = rsi(closes, 14)[n - 1]!;
  const mom10 = (last - closes[n - 11]) / closes[n - 11];
  const vol = stddev(returns.slice(-20));

  const signals: Prediction["signals"] = [];

  // Trend vote: SMA20 above SMA50 = bullish
  const trendVote = sma20 > sma50 ? 1 : sma20 < sma50 ? -1 : 0;
  signals.push({
    name: "Trend (SMA20/50)",
    value: sma20 > sma50 ? "bullish" : "bearish",
    vote: trendVote,
  });

  // Momentum vote
  const momVote = mom10 > 0.01 ? 1 : mom10 < -0.01 ? -1 : 0;
  signals.push({
    name: "Momentum (10d)",
    value: `${(mom10 * 100).toFixed(2)}%`,
    vote: momVote,
  });

  // Mean-reversion vote via RSI
  const mrVote = rsi14 < 30 ? 1 : rsi14 > 70 ? -1 : 0;
  signals.push({
    name: "RSI(14)",
    value: rsi14.toFixed(1),
    vote: mrVote,
  });

  const score = trendVote * 0.45 + momVote * 0.4 + mrVote * 0.15;
  // squash to probability with a gentle logistic — keep it modest
  const probabilityUp = 1 / (1 + Math.exp(-2.2 * score));

  // expected next-day return: mean of recent returns nudged by score
  const meanRet = returns.slice(-20).reduce((a, b) => a + b, 0) / 20;
  const expectedReturnPct = (meanRet + score * vol * 0.5) * 100;

  // Confidence is intentionally capped: short-horizon edge is tiny & noisy.
  const rawConf = Math.abs(score) * (1 - Math.min(vol * 8, 0.8));
  const confidence = Math.min(0.55, Math.max(0.05, rawConf));

  const direction: Prediction["direction"] =
    probabilityUp > 0.55 ? "up" : probabilityUp < 0.45 ? "down" : "flat";

  const regime = detectRegime(closes, rsi14, sma20, sma50);

  // Confidence breakdown — explain to user what each factor contributes
  const sepContrib = Math.abs(score) * 0.55;
  const breakdown = [
    {
      factor: "Separação dos sinais",
      impact: sepContrib > 0.15 ? "+moderado" : "+fraco",
      note: `${signals.filter(s => s.vote !== 0).length}/3 sinais em acordo — ${Math.abs(score) > 0.6 ? "forte consenso" : Math.abs(score) > 0.3 ? "consenso parcial" : "sinais contraditórios"}`,
    },
    {
      factor: "Volatilidade",
      impact: vol > 0.02 ? "−penalidade" : "−baixa",
      note: `Volatilidade 20d: ${(vol*100).toFixed(2)}% — ${vol > 0.03 ? "alta (reduz fiabilidade)" : vol > 0.015 ? "moderada" : "baixa (favorável)"}`,
    },
    {
      factor: "Regime de mercado",
      impact: regime.regime === "sideways" ? "−neutro" : `+${regime.regime}`,
      note: `Mercado ${regime.regime === "bull" ? "em alta" : regime.regime === "bear" ? "em baixa" : "lateral"} ${regime.strength} — ${regime.regime === "sideways" ? "sinal menos fiável em lateralização" : "sinal alinhado com tendência"}`,
    },
    {
      factor: "Horizonte temporal",
      impact: "−estrutural",
      note: "Previsão de curto prazo (1–5 dias). Mercados têm ruído elevado neste horizonte — limite intrínseco do modelo.",
    },
  ];

  const confPct = Math.round(confidence * 100);
  const confLabel =
    confPct >= 45 ? "Moderada" : confPct >= 25 ? "Baixa" : "Muito baixa";

  // --- Platt calibration (conservative slope) ---
  const probabilityUpCalibrated = plattCalibrate(probabilityUp);

  // --- Volume signal ---
  const volSignal = computeVolumeSignal(candles, direction === "flat" ? "up" : direction);

  // --- Known correlations ---
  const correlations = KNOWN_CORRELATIONS[symbol] ?? null;

  return {
    symbol,
    lastClose: last,
    direction,
    probabilityUp,
    probabilityUpCalibrated,
    expectedReturnPct,
    confidence,
    signals,
    asOf: candles[n - 1].date,
    regime,
    confidenceExplained: { label: confLabel, pct: confPct, breakdown },
    volumeSignal: { signal: volSignal.signal, ratio: volSignal.ratio, confirmsMove: volSignal.confirmsMove },
    correlations,
  };
}

// ---------- Backtest ----------
// Walk-forward backtest of an SMA-cross strategy vs buy & hold.

export type BacktestResult = {
  symbol: string;
  strategy: string;
  equityCurve: { date: string; strategy: number; buyHold: number }[];
  stats: {
    totalReturnPct: number;
    buyHoldReturnPct: number;
    sharpe: number;
    maxDrawdownPct: number;
    winRate: number;
    trades: number;
  };
};

export function backtestSmaCross(
  symbol: string,
  candles: Candle[],
  fast = 20,
  slow = 50,
): BacktestResult {
  const closes = candles.map((c) => c.close);
  const smaFast = sma(closes, fast);
  const smaSlow = sma(closes, slow);

  let equity = 1;
  let bh = 1;
  let position = 0; // 0 flat, 1 long
  let entryPrice = 0;
  let wins = 0;
  let trades = 0;
  const dailyReturns: number[] = [];
  const curve: BacktestResult["equityCurve"] = [];
  let peak = 1;
  let maxDd = 0;

  const startBh = closes[slow];
  for (let i = slow; i < closes.length; i++) {
    const f = smaFast[i]!;
    const s = smaSlow[i]!;
    const dailyRet = (closes[i] - closes[i - 1]) / closes[i - 1];

    if (position === 1) {
      equity *= 1 + dailyRet;
      dailyReturns.push(dailyRet);
    } else {
      dailyReturns.push(0);
    }

    // signals
    if (position === 0 && f > s) {
      position = 1;
      entryPrice = closes[i];
      trades++;
    } else if (position === 1 && f < s) {
      if (closes[i] > entryPrice) wins++;
      position = 0;
    }

    bh = closes[i] / startBh;
    peak = Math.max(peak, equity);
    maxDd = Math.max(maxDd, (peak - equity) / peak);

    curve.push({
      date: candles[i].date,
      strategy: +(equity).toFixed(4),
      buyHold: +(bh).toFixed(4),
    });
  }

  const meanD = dailyReturns.reduce((a, b) => a + b, 0) / dailyReturns.length;
  const sd = Math.sqrt(
    dailyReturns.reduce((a, b) => a + (b - meanD) ** 2, 0) / dailyReturns.length,
  );
  const sharpe = sd === 0 ? 0 : (meanD / sd) * Math.sqrt(252);

  return {
    symbol,
    strategy: `SMA ${fast}/${slow} cross`,
    equityCurve: curve,
    stats: {
      totalReturnPct: (equity - 1) * 100,
      buyHoldReturnPct: (bh - 1) * 100,
      sharpe,
      maxDrawdownPct: maxDd * 100,
      winRate: trades ? (wins / trades) * 100 : 0,
      trades,
    },
  };
}
