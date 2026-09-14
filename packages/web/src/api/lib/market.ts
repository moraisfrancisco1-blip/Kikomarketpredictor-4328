// Market data fetching + prediction / backtest logic.
import { detectRegime } from "./tracker";
import { plattCalibrate, computeVolumeSignal, KNOWN_CORRELATIONS } from "./market-enrichment";
export { fetchSentiment, fetchEarningsInfo, type SentimentResult, type EarningsInfo } from "./market-enrichment";

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

const CACHE = new Map<string, { ts: number; candles: Candle[] }>();
const TTL = 5 * 60 * 1000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

// ---- Alpha Vantage fallback ----
async function fetchFromAlpha(symbol: string): Promise<Candle[]> {
  const key = getAlphaKey();
  if (!key) throw new Error("no fallback key");

  const isCrypto = symbol.includes("/");
  let url: string;
  if (isCrypto) {
    const [from, to] = symbol.split("/");
    url = `${AV_BASE}?function=DIGITAL_CURRENCY_DAILY&symbol=${from}&market=${to}&apikey=${key}`;
  } else {
    url = `${AV_BASE}?function=TIME_SERIES_DAILY&symbol=${encodeURIComponent(symbol)}&outputsize=compact&apikey=${key}`;
  }

  const res = await fetch(url);
  if (!res.ok) throw new Error(`fallback http ${res.status}`);
  const json: any = await res.json();
  if (json.Note || json.Information) throw new Error("fallback rate limited");

  const seriesKey = Object.keys(json).find((k) => k.includes("Time Series"));
  if (!seriesKey) throw new Error("fallback no data");
  const series = json[seriesKey];

  const candles: Candle[] = Object.entries(series)
    .map(([date, v]: [string, any]) => {
      const open = parseFloat(v["1. open"] ?? v["1a. open (USD)"] ?? v["1b. open (USD)"]);
      const high = parseFloat(v["2. high"] ?? v["2a. high (USD)"] ?? v["2b. high (USD)"]);
      const low = parseFloat(v["3. low"] ?? v["3a. low (USD)"] ?? v["3b. low (USD)"]);
      const close = parseFloat(v["4. close"] ?? v["4a. close (USD)"] ?? v["4b. close (USD)"]);
      const volume = parseFloat(v["5. volume"] ?? v["5. volume (USD)"] ?? "0");
      return { date, open, high, low, close, volume };
    })
    .filter((c) => Number.isFinite(c.close))
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(-400);

  if (candles.length === 0) throw new Error("fallback no usable data");
  return candles;
}

export async function fetchCandles(symbol: string, outputsize = 400): Promise<Candle[]> {
  const apikey = getApiKey();
  const key = symbol;
  const cached = CACHE.get(key);
  if (cached && Date.now() - cached.ts < TTL && cached.candles.length >= outputsize) {
    return cached.candles.slice(-outputsize);
  }

  const url = `${TD_BASE}/time_series?symbol=${encodeURIComponent(symbol)}&interval=1day&outputsize=400&apikey=${apikey}`;
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
  if (res.status === 429) {
    await sleep(1500);
    res = await fetch(url);
  }
  if (res.status === 429) return tryFallback("rate limited — wait a few seconds and retry");
  if (!res.ok) return tryFallback(`provider http ${res.status}`);

  const json: any = await res.json();
  if (json.status === "error") return tryFallback(json.message || "provider error");
  if (!Array.isArray(json.values)) return tryFallback("no data for symbol");

  const candles: Candle[] = json.values
    .map((v: any) => ({
      date: v.datetime,
      open: parseFloat(v.open),
      high: parseFloat(v.high),
      low: parseFloat(v.low),
      close: parseFloat(v.close),
      volume: parseFloat(v.volume ?? "0"),
    }))
    .reverse()
    .filter((c: Candle) => Number.isFinite(c.close));
  CACHE.set(key, { ts: Date.now(), candles });
  return candles.slice(-outputsize);
}

// ---------- Indicators ----------
export function sma(values: number[], period: number): (number | null)[] {
  const out: (number | null)[] = [];
  for (let i = 0; i < values.length; i++) {
    if (i < period - 1) out.push(null);
    else {
      let sum = 0;
      for (let j = i - period + 1; j <= i; j++) sum += values[j];
      out.push(sum / period);
    }
  }
  return out;
}

export function ema(values: number[], period: number): number[] {
  const k = 2 / (period + 1);
  const out: number[] = [];
  let prev = values[0] ?? 0;
  for (let i = 0; i < values.length; i++) {
    prev = i === 0 ? values[0] : values[i] * k + prev * (1 - k);
    out.push(prev);
  }
  return out;
}

export function rsi(values: number[], period = 14): (number | null)[] {
  const out: (number | null)[] = new Array(values.length).fill(null);
  if (values.length <= period) return out;
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
  if (!values.length) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

function atrPct(candles: Candle[], period = 14): number {
  if (candles.length < period + 1) return 0;
  const trs: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    const c = candles[i];
    const prevClose = candles[i - 1].close;
    trs.push(Math.max(c.high - c.low, Math.abs(c.high - prevClose), Math.abs(c.low - prevClose)));
  }
  const recent = trs.slice(-period);
  const atr = recent.reduce((a, b) => a + b, 0) / recent.length;
  return atr / candles[candles.length - 1].close;
}

function logistic(x: number): number {
  return 1 / (1 + Math.exp(-x));
}

// ---------- Prediction ensemble ----------
// This is an explainable signal ensemble, not a guarantee of future returns.
// It intentionally separates direction from confidence and avoids extreme output.
export type Prediction = {
  symbol: string;
  lastClose: number;
  direction: "up" | "down" | "flat";
  probabilityUp: number;
  probabilityUpCalibrated: number;
  probabilityDown?: number;
  probabilityFlat?: number;
  expectedReturnPct: number;
  confidence: number;
  signals: { name: string; value: string; vote: number }[];
  asOf: string;
  dataQuality?: { score: number; label: string; sampleSize: number; warning: string | null };
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
  if (candles.length < 60) {
    throw new Error("At least 60 daily candles are required for a reliable prediction");
  }

  const closes = candles.map((c) => c.close);
  const n = closes.length;
  const last = closes[n - 1];
  const returns: number[] = [];
  for (let i = 1; i < n; i++) returns.push((closes[i] - closes[i - 1]) / closes[i - 1]);

  const sma20 = sma(closes, 20)[n - 1] ?? last;
  const sma50 = sma(closes, 50)[n - 1] ?? last;
  const sma200 = n >= 200 ? sma(closes, 200)[n - 1] : null;
  const rsi14 = rsi(closes, 14)[n - 1] ?? 50;
  const ema12 = ema(closes, 12);
  const ema26 = ema(closes, 26);
  const macd = ema12[n - 1] - ema26[n - 1];
  const macdSignal = ema(ema12.map((v, i) => v - ema26[i]), 9).at(-1) ?? 0;
  const macdHist = macd - macdSignal;
  const mom5 = (last - closes[n - 6]) / closes[n - 6];
  const mom10 = (last - closes[n - 11]) / closes[n - 11];
  const mom20 = (last - closes[n - 21]) / closes[n - 21];
  const vol = stddev(returns.slice(-20));
  const atr = atrPct(candles);
  const high52 = Math.max(...closes.slice(-Math.min(252, n)));
  const low52 = Math.min(...closes.slice(-Math.min(252, n)));
  const rangePosition = high52 === low52 ? 0.5 : (last - low52) / (high52 - low52);
  const signals: Prediction["signals"] = [];

  const trendVote = sma20 > sma50 && (sma200 == null || last > sma200) ? 1 : sma20 < sma50 && (sma200 == null || last < sma200) ? -1 : 0;
  signals.push({ name: "Trend (SMA20/50)", value: trendVote > 0 ? "bullish" : trendVote < 0 ? "bearish" : "mixed", vote: trendVote });

  const momentumComposite = (mom5 * 0.2 + mom10 * 0.35 + mom20 * 0.45);
  const momVote = momentumComposite > 0.006 ? 1 : momentumComposite < -0.006 ? -1 : 0;
  signals.push({ name: "Momentum (5/10/20d)", value: `${(momentumComposite * 100).toFixed(2)}%`, vote: momVote });

  const macdVote = macdHist > 0 ? 1 : macdHist < 0 ? -1 : 0;
  signals.push({ name: "MACD", value: macdHist > 0 ? "bullish" : "bearish", vote: macdVote });

  const mrVote = rsi14 < 35 ? 1 : rsi14 > 68 ? -1 : 0;
  signals.push({ name: "RSI(14)", value: rsi14.toFixed(1), vote: mrVote });

  const volumeAvg = candles.slice(-21, -1).reduce((sum, c) => sum + c.volume, 0) / 20;
  const volumeRatio = volumeAvg > 0 ? candles[n - 1].volume / volumeAvg : 1;
  const lastDayMove = n > 1 ? (last - closes[n - 2]) / closes[n - 2] : 0;
  const volumeVote = volumeRatio > 1.2 && lastDayMove > 0 ? 1 : volumeRatio > 1.2 && lastDayMove < 0 ? -1 : 0;
  signals.push({ name: "Volume confirmation", value: `${volumeRatio.toFixed(2)}x average`, vote: volumeVote });

  const rangeVote = rangePosition > 0.7 ? 1 : rangePosition < 0.3 ? -1 : 0;
  signals.push({ name: "Range position", value: `${(rangePosition * 100).toFixed(0)}% of 52w range`, vote: rangeVote });

  // Weighted ensemble. Trend and multi-horizon momentum carry the largest weight;
  // RSI is intentionally small because mean reversion is regime-dependent.
  const score = clamp(
    trendVote * 0.28 +
      momVote * 0.24 +
      macdVote * 0.18 +
      mrVote * 0.08 +
      volumeVote * 0.12 +
      rangeVote * 0.10,
    -1,
    1,
  );

  const directionalProbability = logistic(score * 1.8);
  // Static Platt parameters are not a substitute for empirical calibration.
  // Until a tracked prediction history exists, shrink toward 0.5 to avoid false precision.
  const probabilityUpCalibrated = plattCalibrate(directionalProbability, 0.75, 0);
  const distance = Math.abs(probabilityUpCalibrated - 0.5) * 2;

  const direction: Prediction["direction"] =
    probabilityUpCalibrated >= 0.58 ? "up" : probabilityUpCalibrated <= 0.42 ? "down" : "flat";

  const probabilityFlat = clamp(0.34 - distance * 0.26 + (vol > 0.025 ? 0.08 : 0), 0.08, 0.45);
  const directionalMass = 1 - probabilityFlat;
  const probabilityUp = clamp(probabilityUpCalibrated * directionalMass + probabilityFlat * 0.5, 0.01, 0.99);
  const probabilityDown = clamp(1 - probabilityFlat - probabilityUp, 0.01, 0.99);

  const nonZeroVotes = signals.filter((s) => s.vote !== 0);
  const agreement = nonZeroVotes.length
    ? Math.abs(nonZeroVotes.reduce((sum, s) => sum + s.vote, 0)) / nonZeroVotes.length
    : 0;
  const signalCoverage = nonZeroVotes.length / signals.length;
  const sampleQuality = clamp((n - 60) / 140, 0, 1);
  const volatilityPenalty = clamp(1 - vol * 18, 0.25, 1);
  const confidence = clamp(
    0.12 + distance * 0.34 + agreement * 0.26 + signalCoverage * 0.12 + sampleQuality * 0.10,
    0.05,
    0.82,
  ) * volatilityPenalty;

  const meanRet = returns.slice(-20).reduce((a, b) => a + b, 0) / Math.min(20, returns.length);
  const expectedReturnPct = (meanRet + score * Math.max(vol, atr) * 0.45) * 100;
  const regime = detectRegime(closes, rsi14, sma20, sma50);
  const volSignal = computeVolumeSignal(candles, direction);
  const correlations = KNOWN_CORRELATIONS[symbol] ?? null;

  const confPct = Math.round(confidence * 100);
  const confLabel = confPct >= 70 ? "Alta" : confPct >= 55 ? "Moderada" : confPct >= 35 ? "Baixa" : "Muito baixa";
  const dataScore = Math.round((sampleQuality * 0.7 + Math.min(1, n / 252) * 0.3) * 100);
  const dataWarning = n < 120 ? "Histórico limitado. A previsão deve ser tratada com cautela." : null;

  const breakdown = [
    {
      factor: "Concordância dos sinais",
      impact: agreement >= 0.7 ? "+forte" : agreement >= 0.4 ? "+moderado" : "−fraco",
      note: `${nonZeroVotes.length}/${signals.length} sinais ativos, consenso de ${(agreement * 100).toFixed(0)}%.`,
    },
    {
      factor: "Probabilidade calibrada",
      impact: distance >= 0.25 ? "+moderado" : "−neutro",
      note: `Distância da zona neutra: ${(distance * 100).toFixed(0)}%. Probabilidades são conservadoras até existir calibração baseada em histórico real.`,
    },
    {
      factor: "Volatilidade",
      impact: vol > 0.025 ? "−penalidade" : "−baixa",
      note: `Volatilidade 20d: ${(vol * 100).toFixed(2)}%, ATR: ${(atr * 100).toFixed(2)}%.`,
    },
    {
      factor: "Qualidade dos dados",
      impact: dataScore >= 75 ? "+boa" : "−limitada",
      note: `${n} candles disponíveis. ${dataWarning ?? "Histórico suficiente para indicadores de médio prazo."}`,
    },
  ];

  return {
    symbol,
    lastClose: last,
    direction,
    probabilityUp,
    probabilityUpCalibrated,
    probabilityDown,
    probabilityFlat,
    expectedReturnPct,
    confidence,
    signals,
    asOf: candles[n - 1].date,
    regime,
    dataQuality: { score: dataScore, label: dataScore >= 75 ? "Boa" : "Limitada", sampleSize: n, warning: dataWarning },
    confidenceExplained: { label: confLabel, pct: confPct, breakdown },
    volumeSignal: { signal: volSignal.signal, ratio: volSignal.ratio, confirmsMove: volSignal.confirmsMove },
    correlations,
  };
}

// ---------- Backtest ----------
// Walk-forward backtest of an SMA-cross strategy vs buy & hold.
// Signals are generated at the close and only affect the following day's return.
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
    warning?: string | null;
  };
};

export function backtestSmaCross(symbol: string, candles: Candle[], fast = 20, slow = 50): BacktestResult {
  if (candles.length <= slow + 2) {
    return {
      symbol,
      strategy: `SMA ${fast}/${slow} cross`,
      equityCurve: [],
      stats: { totalReturnPct: 0, buyHoldReturnPct: 0, sharpe: 0, maxDrawdownPct: 0, winRate: 0, trades: 0, warning: "Dados insuficientes para backtest." },
    };
  }

  const closes = candles.map((c) => c.close);
  const smaFast = sma(closes, fast);
  const smaSlow = sma(closes, slow);
  let equity = 1;
  let bh = 1;
  let position = 0;
  let entryPrice = 0;
  let completedTrades = 0;
  let wins = 0;
  const dailyReturns: number[] = [];
  const curve: BacktestResult["equityCurve"] = [];
  let peak = 1;
  let maxDd = 0;
  const startBh = closes[slow];

  for (let i = slow + 1; i < closes.length; i++) {
    const dailyRet = (closes[i] - closes[i - 1]) / closes[i - 1];
    if (position === 1) equity *= 1 + dailyRet;
    dailyReturns.push(position === 1 ? dailyRet : 0);

    // Today's position was decided using information available at the previous close.
    const f = smaFast[i - 1]!;
    const s = smaSlow[i - 1]!;
    if (position === 0 && f > s) {
      position = 1;
      entryPrice = closes[i];
    } else if (position === 1 && f < s) {
      completedTrades++;
      if (closes[i] > entryPrice) wins++;
      position = 0;
      entryPrice = 0;
    }

    bh = closes[i] / startBh;
    peak = Math.max(peak, equity);
    maxDd = Math.max(maxDd, (peak - equity) / peak);
    curve.push({ date: candles[i].date, strategy: +equity.toFixed(4), buyHold: +bh.toFixed(4) });
  }

  // Count an open position as a completed mark-to-market trade for honest win-rate reporting.
  if (position === 1 && entryPrice > 0) {
    completedTrades++;
    if (closes[closes.length - 1] > entryPrice) wins++;
  }

  const meanD = dailyReturns.reduce((a, b) => a + b, 0) / Math.max(1, dailyReturns.length);
  const sd = stddev(dailyReturns);
  const sharpe = sd === 0 ? 0 : (meanD / sd) * Math.sqrt(252);
  const warning = completedTrades < 30
    ? `Apenas ${completedTrades} operações. Amostra pequena demais para validação estatística robusta.`
    : null;

  return {
    symbol,
    strategy: `SMA ${fast}/${slow} cross`,
    equityCurve: curve,
    stats: {
      totalReturnPct: (equity - 1) * 100,
      buyHoldReturnPct: (bh - 1) * 100,
      sharpe,
      maxDrawdownPct: maxDd * 100,
      winRate: completedTrades ? (wins / completedTrades) * 100 : 0,
      trades: completedTrades,
      warning,
    },
  };
}
