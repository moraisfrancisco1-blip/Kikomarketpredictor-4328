import { Hono } from 'hono';
import { cors } from "hono/cors"
import {
  fetchCandles,
  predict,
  backtestSmaCross,
  getApiKey,
  getAlphaKey,
  fetchSentiment,
  fetchEarningsInfo,
} from "./lib/market";
import { fetchLeagueXG } from "./lib/sports";
import {
  generateTickets,
  generateTicket,
  expectedValue,
  monteCarlo,
  frequencyAnalysis,
  lifetimeSimulator,
  analyzeTicket,
} from "./lib/lottery";
import {
  FOOTBALL_LEAGUES,
  fetchFootball,
  predictFootball,
  backtestFootball,
  listTeams,
  fetchFixtures,
  selectUpcoming,
  fetchSdbResults,
  predictGameElo,
  listGameTeams,
  fetchInternational,
  predictInternational,
  backtestInternational,
  listIntlTeams,
  fetchEuroFixtures,
  selectUpcomingEuro,
  EURO_SOURCE_KEYS,
  predictCrossLeague,
  listCrossLeagueTeams,
  backtestCrossLeague,
} from "./lib/sports";

const app = new Hono()
  .basePath('api')
  .use(cors({ origin: (origin) => origin ?? "*", credentials: true, exposeHeaders: ["set-auth-token"] }))
  .get('/health', (c) => c.json({ status: 'ok' }, 200))
  .get('/config', (c) =>
    c.json(
      {
        hasRealKey: getApiKey() !== "demo",
        provider: "Twelve Data",
        hasFallback: getAlphaKey() !== "",
        fallbackProvider: "Alpha Vantage",
      },
      200,
    ),
  )
  // ---- Market data + chart ----
  // Symbol passed as query param so it tolerates "/" (e.g. BTC/USD).
  .get('/markets', async (c) => {
    const symbol = (c.req.query("symbol") ?? "").toUpperCase();
    if (!symbol) return c.json({ error: "symbol required" }, 400);
    try {
      const candles = await fetchCandles(symbol, 400);
      return c.json({ symbol, candles }, 200);
    } catch (e: any) {
      return c.json({ error: e.message || "failed to fetch" }, 502);
    }
  })
  // ---- Prediction ----
  .get('/predict', async (c) => {
    const symbol = (c.req.query("symbol") ?? "").toUpperCase();
    if (!symbol) return c.json({ error: "symbol required" }, 400);
    try {
      const candles = await fetchCandles(symbol, 200);
      if (candles.length < 60)
        return c.json({ error: "not enough history" }, 422);
      const prediction = predict(symbol, candles);
      return c.json({ prediction }, 200);
    } catch (e: any) {
      return c.json({ error: e.message || "failed" }, 502);
    }
  })
  // ---- Backtest ----
  .get('/backtest', async (c) => {
    const symbol = (c.req.query("symbol") ?? "").toUpperCase();
    if (!symbol) return c.json({ error: "symbol required" }, 400);
    const fast = Number(c.req.query("fast") ?? 20);
    const slow = Number(c.req.query("slow") ?? 50);
    try {
      const candles = await fetchCandles(symbol, 400);
      if (candles.length < slow + 20)
        return c.json({ error: "not enough history" }, 422);
      const result = backtestSmaCross(symbol, candles, fast, slow);
      return c.json({ result }, 200);
    } catch (e: any) {
      return c.json({ error: e.message || "failed" }, 502);
    }
  })
  // ---- Sentiment (Yahoo Finance RSS — no key) ----
  .get('/markets/sentiment', async (c) => {
    const symbol = (c.req.query("symbol") ?? "").toUpperCase();
    if (!symbol) return c.json({ error: "symbol required" }, 400);
    try {
      const result = await fetchSentiment(symbol);
      return c.json({ sentiment: result }, 200);
    } catch (e: any) {
      return c.json({ error: e.message || "failed" }, 502);
    }
  })
  // ---- Earnings calendar ----
  .get('/markets/earnings', async (c) => {
    const symbol = (c.req.query("symbol") ?? "").toUpperCase();
    if (!symbol) return c.json({ error: "symbol required" }, 400);
    try {
      const info = await fetchEarningsInfo(symbol);
      return c.json({ earnings: info }, 200);
    } catch (e: any) {
      return c.json({ error: e.message || "failed" }, 502);
    }
  })
  // ---- League xG stats ----
  .get('/sports/football/xg', async (c) => {
    const league = (c.req.query("league") ?? "").toUpperCase();
    if (!league) return c.json({ error: "league required" }, 400);
    try {
      const xgMap = await fetchLeagueXG(league);
      return c.json({ xg: Object.fromEntries(xgMap) }, 200);
    } catch (e: any) {
      return c.json({ error: e.message || "failed" }, 502);
    }
  })
  // ---- Lottery ----
  .get('/lottery/euromillions/generate', (c) => {
    const n = Math.min(Number(c.req.query("n") ?? 5), 20);
    const strategy = (c.req.query("strategy") ?? "random") as any;
    return c.json({ tickets: generateTickets(n, strategy) }, 200);
  })
  .get('/lottery/euromillions/ev', (c) => {
    return c.json({ ev: expectedValue() }, 200);
  })
  .get('/lottery/euromillions/simulate', (c) => {
    const tickets = Math.min(
      Math.max(Number(c.req.query("tickets") ?? 10000), 1),
      5_000_000,
    );
    return c.json({ simulation: monteCarlo(tickets) }, 200);
  })
  .get('/lottery/euromillions/frequency', (c) => {
    return c.json({ analysis: frequencyAnalysis() }, 200);
  })
  .get('/lottery/euromillions/lifetime', (c) => {
    const playsPerWeek = Math.min(Number(c.req.query("playsPerWeek") ?? 2), 50);
    const weeksPerYear = Math.min(Number(c.req.query("weeksPerYear") ?? 104), 104);
    const years = Math.min(Number(c.req.query("years") ?? 10), 80);
    return c.json({ simulation: lifetimeSimulator(playsPerWeek, weeksPerYear, years) }, 200);
  })
  .post('/lottery/euromillions/analyze', async (c) => {
    const body = await c.req.json();
    const { main, stars } = body;
    if (!Array.isArray(main) || !Array.isArray(stars) || main.length !== 5 || stars.length !== 2) {
      return c.json({ error: "Precisa de 5 números principais (1-50) e 2 estrelas (1-12)" }, 400);
    }
    return c.json({ analysis: analyzeTicket(main, stars) }, 200);
  })
  // ---- Sports: NO bookmaker odds, pure data ----
  .get('/sports/football/leagues', (c) => {
    const leagues = Object.entries(FOOTBALL_LEAGUES).map(([code, v]) => ({
      code,
      name: v.name,
    }));
    return c.json({ leagues }, 200);
  })
  .get('/sports/football/teams', async (c) => {
    const code = (c.req.query("league") ?? "E0").toUpperCase();
    try {
      const matches = await fetchFootball(code);
      return c.json({ teams: listTeams(matches), sample: matches.length }, 200);
    } catch (e: any) {
      return c.json({ error: e.message || "failed" }, 502);
    }
  })
  .get('/sports/football/predict', async (c) => {
    const code = (c.req.query("league") ?? "E0").toUpperCase();
    const home = c.req.query("home") ?? "";
    const away = c.req.query("away") ?? "";
    if (!home || !away) return c.json({ error: "home and away required" }, 400);
    if (home === away) return c.json({ error: "pick two different teams" }, 400);
    const parseF = (v: string | undefined, def = 1) => { const n = parseFloat(v ?? ""); return isNaN(n) ? def : Math.max(0.3, Math.min(1.8, n)); };
    const extOpts = {
      homeAttackMult: parseF(c.req.query("homeAttackMult") ?? undefined, 1),
      homeDefMult: parseF(c.req.query("homeDefMult") ?? undefined, 1),
      awayAttackMult: parseF(c.req.query("awayAttackMult") ?? undefined, 1),
      awayDefMult: parseF(c.req.query("awayDefMult") ?? undefined, 1),
      motivationFactor: parseF(c.req.query("motivationFactor") ?? undefined, 1),
    };
    try {
      const matches = await fetchFootball(code);
      const leagueName = FOOTBALL_LEAGUES[code]?.name ?? code;
      const prediction = predictFootball(leagueName, matches, home, away, extOpts);
      // EV calculation if odds supplied
      const ev: Record<string, number | null> = { home: null, draw: null, away: null };
      const hOdds = parseFloat(c.req.query("homeOdds") ?? "");
      const dOdds = parseFloat(c.req.query("drawOdds") ?? "");
      const aOdds = parseFloat(c.req.query("awayOdds") ?? "");
      if (!isNaN(hOdds) && hOdds > 1) ev.home = +(prediction.probHome - 1 / hOdds).toFixed(4);
      if (!isNaN(dOdds) && dOdds > 1) ev.draw = +(prediction.probDraw - 1 / dOdds).toFixed(4);
      if (!isNaN(aOdds) && aOdds > 1) ev.away = +(prediction.probAway - 1 / aOdds).toFixed(4);
      return c.json({ prediction: { ...prediction, ev } }, 200);
    } catch (e: any) {
      return c.json({ error: e.message || "failed" }, 502);
    }
  })
  .get('/sports/football/backtest', async (c) => {
    const code = (c.req.query("league") ?? "E0").toUpperCase();
    try {
      const matches = await fetchFootball(code);
      const bt = backtestFootball(code, matches);
      return c.json({ backtest: bt }, 200);
    } catch (e: any) {
      return c.json({ error: e.message || "failed" }, 502);
    }
  })
  .get('/sports/football/fixtures', async (c) => {
    const code = (c.req.query("league") ?? "E0").toUpperCase();
    const today = c.req.query("today") || new Date().toISOString().slice(0, 10);
    const days = Math.min(30, Math.max(1, parseInt(c.req.query("days") ?? "7", 10) || 7));
    try {
      const matches = await fetchFootball(code);
      const teams = listTeams(matches);
      const { fixtures, season } = await fetchFixtures(code, teams);
      const { list, offseason } = selectUpcoming(fixtures, today, days);
      const leagueName = FOOTBALL_LEAGUES[code]?.name ?? code;
      const games = list.map((f) => {
        let prediction: any = null;
        let error: string | null = null;
        if (f.home && f.away && f.home !== f.away) {
          try {
            prediction = predictFootball(leagueName, matches, f.home, f.away);
          } catch (e: any) {
            error = e?.message ?? "no model";
          }
        } else {
          error = "team not mapped";
        }
        return {
          date: f.date,
          time: f.time,
          round: f.round,
          home: f.home ?? f.homeOpen,
          away: f.away ?? f.awayOpen,
          played: f.played,
          prediction,
          error,
        };
      });
      return c.json({ league: leagueName, season, offseason, count: games.length, games }, 200);
    } catch (e: any) {
      return c.json({ error: e.message || "failed" }, 502);
    }
  })
  // ---- European competitions + Friendlies fixtures ----
  .get('/sports/euro/sources', (c) => {
    return c.json({ sources: EURO_SOURCE_KEYS }, 200);
  })
  .get('/sports/euro/fixtures', async (c) => {
    const key = c.req.query("key") ?? "wcup";
    const today = c.req.query("today") || new Date().toISOString().slice(0, 10);
    const days = Math.min(60, Math.max(1, parseInt(c.req.query("days") ?? "14", 10) || 14));
    try {
      const fixtures = await fetchEuroFixtures(key);
      const { list, offseason } = selectUpcomingEuro(fixtures, today, days);
      const source = EURO_SOURCE_KEYS.find((s) => s.key === key);
      return c.json({
        competition: source?.label ?? key,
        offseason,
        count: list.length,
        games: list,
      }, 200);
    } catch (e: any) {
      return c.json({ error: e.message || "failed" }, 502);
    }
  })
  .get('/sports/euro/predict', async (c) => {
    const home = c.req.query("home") ?? "";
    const away = c.req.query("away") ?? "";
    if (!home || !away) return c.json({ error: "home e away são obrigatórios" }, 400);
    const parseF = (v: string | undefined, def = 1) => { const n = parseFloat(v ?? ""); return isNaN(n) ? def : Math.max(0.3, Math.min(1.8, n)); };
    const extOpts = {
      homeAttackMult: parseF(c.req.query("homeAttackMult") ?? undefined, 1),
      homeDefMult: parseF(c.req.query("homeDefMult") ?? undefined, 1),
      awayAttackMult: parseF(c.req.query("awayAttackMult") ?? undefined, 1),
      awayDefMult: parseF(c.req.query("awayDefMult") ?? undefined, 1),
      motivationFactor: parseF(c.req.query("motivationFactor") ?? undefined, 1),
    };
    try {
      const prediction = await predictCrossLeague(home, away, extOpts);
      const ev: Record<string, number | null> = { home: null, draw: null, away: null };
      const hOdds = parseFloat(c.req.query("homeOdds") ?? "");
      const dOdds = parseFloat(c.req.query("drawOdds") ?? "");
      const aOdds = parseFloat(c.req.query("awayOdds") ?? "");
      if (!isNaN(hOdds) && hOdds > 1) ev.home = +(prediction.probHome - 1 / hOdds).toFixed(4);
      if (!isNaN(dOdds) && dOdds > 1) ev.draw = +(prediction.probDraw - 1 / dOdds).toFixed(4);
      if (!isNaN(aOdds) && aOdds > 1) ev.away = +(prediction.probAway - 1 / aOdds).toFixed(4);
      return c.json({ prediction: { ...prediction, ev } }, 200);
    } catch (e: any) {
      return c.json({ error: e.message || "failed" }, 502);
    }
  })
  .get('/sports/euro/teams', async (c) => {
    try {
      const teams = await listCrossLeagueTeams();
      return c.json({ teams }, 200);
    } catch (e: any) {
      return c.json({ error: e.message || "failed" }, 502);
    }
  })
  .get('/sports/euro/backtest', async (c) => {
    try {
      const bt = await backtestCrossLeague();
      return c.json({ backtest: bt }, 200);
    } catch (e: any) {
      return c.json({ error: e.message || "failed" }, 502);
    }
  })
  .get('/sports/nba/teams', async (c) => {
    try {
      const games = await fetchSdbResults("nba");
      return c.json({ teams: listGameTeams(games), sample: games.length }, 200);
    } catch (e: any) {
      return c.json({ error: e.message || "failed" }, 502);
    }
  })
  .get('/sports/nba/predict', async (c) => {
    const home = c.req.query("home") ?? "";
    const away = c.req.query("away") ?? "";
    if (!home || !away) return c.json({ error: "home and away required" }, 400);
    if (home === away) return c.json({ error: "pick two different teams" }, 400);
    try {
      const games = await fetchSdbResults("nba");
      const prediction = predictGameElo(games, home, away);
      return c.json({ prediction }, 200);
    } catch (e: any) {
      return c.json({ error: e.message || "failed" }, 502);
    }
  })
  // ---- International / World Cup (national teams) ----
  .get('/sports/international/teams', async (c) => {
    try {
      const matches = await fetchInternational();
      return c.json({ teams: listIntlTeams(matches), sample: matches.length }, 200);
    } catch (e: any) {
      return c.json({ error: e.message || "failed" }, 502);
    }
  })
  .get('/sports/international/predict', async (c) => {
    const home = c.req.query("home") ?? "";
    const away = c.req.query("away") ?? "";
    const neutral = (c.req.query("neutral") ?? "true").toLowerCase() !== "false";
    if (!home || !away) return c.json({ error: "home and away required" }, 400);
    if (home === away) return c.json({ error: "pick two different teams" }, 400);
    const parseF = (v: string | undefined, def = 1) => { const n = parseFloat(v ?? ""); return isNaN(n) ? def : Math.max(0.3, Math.min(1.8, n)); };
    const extOpts = {
      homeAttackMult: parseF(c.req.query("homeAttackMult") ?? undefined, 1),
      homeDefMult: parseF(c.req.query("homeDefMult") ?? undefined, 1),
      awayAttackMult: parseF(c.req.query("awayAttackMult") ?? undefined, 1),
      awayDefMult: parseF(c.req.query("awayDefMult") ?? undefined, 1),
      motivationFactor: parseF(c.req.query("motivationFactor") ?? undefined, 1),
    };
    try {
      const matches = await fetchInternational();
      const prediction = predictInternational(matches, home, away, neutral, extOpts);
      const ev: Record<string, number | null> = { home: null, draw: null, away: null };
      const hOdds = parseFloat(c.req.query("homeOdds") ?? "");
      const dOdds = parseFloat(c.req.query("drawOdds") ?? "");
      const aOdds = parseFloat(c.req.query("awayOdds") ?? "");
      if (!isNaN(hOdds) && hOdds > 1) ev.home = +(prediction.probHome - 1 / hOdds).toFixed(4);
      if (!isNaN(dOdds) && dOdds > 1) ev.draw = +(prediction.probDraw - 1 / dOdds).toFixed(4);
      if (!isNaN(aOdds) && aOdds > 1) ev.away = +(prediction.probAway - 1 / aOdds).toFixed(4);
      return c.json({ prediction: { ...prediction, ev } }, 200);
    } catch (e: any) {
      return c.json({ error: e.message || "failed" }, 502);
    }
  })
  .get('/sports/international/backtest', async (c) => {
    try {
      const matches = await fetchInternational();
      const bt = backtestInternational(matches);
      return c.json({ backtest: bt }, 200);
    } catch (e: any) {
      return c.json({ error: e.message || "failed" }, 502);
    }
  });

// ─── ML MICROSERVICE PROXY (port 4201) ───────────────────────────────────────

const ML_BASE = "http://localhost:4201";

async function proxyML(path: string, body?: unknown): Promise<Response> {
  const url = `${ML_BASE}${path}`;
  const opts: RequestInit = body
    ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }
    : { method: "GET" };
  return fetch(url, opts);
}

app
  .post("/ml/football/ensemble", async (c) => {
    try {
      const body = await c.req.json();
      const upstream = await proxyML("/predict/football", body);
      if (!upstream.ok) return c.json({ error: "ml service error" }, 502);
      return c.json(await upstream.json(), 200);
    } catch (e: any) {
      return c.json({ error: e.message || "ml unavailable" }, 503);
    }
  })
  .post("/ml/market/ensemble", async (c) => {
    try {
      const body = await c.req.json();
      const upstream = await proxyML("/predict/market", body);
      if (!upstream.ok) return c.json({ error: "ml service error" }, 502);
      return c.json(await upstream.json(), 200);
    } catch (e: any) {
      return c.json({ error: e.message || "ml unavailable" }, 503);
    }
  })
  .get("/ml/injuries/:eventId", async (c) => {
    try {
      const { eventId } = c.req.param();
      const source = c.req.query("source") ?? "sofascore";
      const upstream = await proxyML(`/injuries/${eventId}?source=${source}`);
      if (!upstream.ok) return c.json({ error: "ml service error" }, 502);
      return c.json(await upstream.json(), 200);
    } catch (e: any) {
      return c.json({ error: e.message || "ml unavailable" }, 503);
    }
  })
  .get("/ml/health", async (c) => {
    try {
      const upstream = await proxyML("/health");
      if (!upstream.ok) return c.json({ status: "down" }, 502);
      return c.json(await upstream.json(), 200);
    } catch {
      return c.json({ status: "down", reason: "unreachable" }, 503);
    }
  });

export type AppType = typeof app;
export default app;
