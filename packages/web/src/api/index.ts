import { Hono } from "hono";
import { cors } from "hono/cors";
import legacyApp from "./index-legacy.js";
import { FOOTBALL_LEAGUES, fetchFootball, predictFootball, listTeams, fetchFixtures, selectUpcoming, predictCrossLeagueProduction, fetchCrossLeagueDataProduction, fetchEuroFixtures, selectUpcomingEuro, EURO_SOURCE_KEYS } from "./lib/sports.js";
import { recordFootballPrediction, reportFootballLedger, resolveFootballPrediction } from "./lib/football-prediction-ledger.js";
import { getFootballPrediction, listFootballPredictions, saveFootballPrediction } from "./lib/football-prediction-ledger-store.js";
import { getFootballPredictionDb, listFootballPredictionsDb, saveFootballPredictionDb } from "./lib/football-prediction-ledger-db.js";
import { evaluateFootballOos } from "./lib/football-oos-validation.js";
import { fetchPrimeiraLigaFixtures, fetchChampionsLeagueFixturesFree, fetchEuropaLeagueFixturesFree } from "./lib/football-free-sources.js";

const app = new Hono().basePath("api").use(cors({ origin: (origin) => origin ?? "*", credentials: true, exposeHeaders: ["set-auth-token"] }));
const parseMultiplier = (value: string | undefined, def = 1) => { const n = parseFloat(value ?? ""); return Number.isFinite(n) ? Math.max(0.3, Math.min(1.8, n)) : def; };

app.post("/auth/login", async (c) => {
  try {
    const body = await c.req.json<{ password?: unknown }>();
    const supplied = typeof body.password === "string" ? body.password : "";
    const configured = process.env.APP_PASSWORD?.trim() || process.env.VITE_APP_PASSWORD?.trim();
    if (!configured) return c.json({ ok: false, error: "authentication is not configured" }, 503);
    if (!supplied || supplied !== configured) return c.json({ ok: false, error: "invalid password" }, 401);
    return c.json({ ok: true }, 200);
  } catch {
    return c.json({ ok: false, error: "invalid request" }, 400);
  }
});

async function saveLedgerRow(row: Awaited<ReturnType<typeof recordFootballPrediction>>) {
  try {
    return await saveFootballPredictionDb(row);
  } catch (error) {
    if (error instanceof Error && error.message.includes("DATABASE_URL is required")) return saveFootballPrediction(row);
    throw error;
  }
}

async function getLedgerRow(predictionId: string) {
  try {
    return await getFootballPredictionDb(predictionId);
  } catch (error) {
    if (error instanceof Error && error.message.includes("DATABASE_URL is required")) return getFootballPrediction(predictionId);
    throw error;
  }
}

async function listLedgerRows() {
  try {
    return await listFootballPredictionsDb();
  } catch (error) {
    if (error instanceof Error && error.message.includes("DATABASE_URL is required")) return listFootballPredictions();
    throw error;
  }
}

app.get("/sports/football/predict", async (c) => {
  const code = (c.req.query("league") ?? "E0").toUpperCase(), home = c.req.query("home") ?? "", away = c.req.query("away") ?? "";
  const requestedFixtureDate = c.req.query("fixtureDate")?.trim() ?? "";
  // The manual predictor UI historically did not send a date. Using today's
  // date is a safe as-of boundary: it never falls back to the latest match
  // and therefore cannot introduce future-result leakage. Future fixtures
  // should send their explicit fixtureDate.
  const fixtureDate = requestedFixtureDate || new Date().toISOString().slice(0, 10);
  if (!home || !away) return c.json({ error: "home and away required" }, 400);
  if (home === away) return c.json({ error: "pick two different teams" }, 400);
  try {
    const matches = await fetchFootball(code), leagueName = FOOTBALL_LEAGUES[code]?.name ?? code;
    const prediction = predictFootball(leagueName, matches, home, away, { fixtureDate, homeAttackMult: parseMultiplier(c.req.query("homeAttackMult")), homeDefMult: parseMultiplier(c.req.query("homeDefMult")), awayAttackMult: parseMultiplier(c.req.query("awayAttackMult")), awayDefMult: parseMultiplier(c.req.query("awayDefMult")), motivationFactor: parseMultiplier(c.req.query("motivationFactor")) });
    const ev: Record<string, number | null> = { home: null, draw: null, away: null };
    const homeOdds = parseFloat(c.req.query("homeOdds") ?? ""), drawOdds = parseFloat(c.req.query("drawOdds") ?? ""), awayOdds = parseFloat(c.req.query("awayOdds") ?? "");
    if (Number.isFinite(homeOdds) && homeOdds > 1) ev.home = +(prediction.probHome - 1 / homeOdds).toFixed(4);
    if (Number.isFinite(drawOdds) && drawOdds > 1) ev.draw = +(prediction.probDraw - 1 / drawOdds).toFixed(4);
    if (Number.isFinite(awayOdds) && awayOdds > 1) ev.away = +(prediction.probAway - 1 / awayOdds).toFixed(4);
    return c.json({ prediction: { ...prediction, ev, fixtureDateSource: requestedFixtureDate ? "explicit" : "today" } }, 200);
  } catch (e: any) { return c.json({ error: e?.message ?? "failed" }, 502); }
});

app.post("/sports/football/predictions/track", async (c) => {
  try { const row = recordFootballPrediction(await c.req.json()); const saved = await saveLedgerRow(row); return c.json({ prediction: saved }, 201); }
  catch (e: any) { return c.json({ error: e?.message ?? "invalid prediction" }, 400); }
});

app.post("/sports/football/predictions/:predictionId/resolve", async (c) => {
  const id = c.req.param("predictionId");
  try {
    const existing = await getLedgerRow(id);
    if (!existing) return c.json({ error: "prediction not found" }, 404);
    const outcome = Number((await c.req.json())?.outcome);
    if (![0, 1, 2].includes(outcome)) return c.json({ error: "outcome must be 0, 1, or 2" }, 400);
    const row = resolveFootballPrediction(existing, outcome as 0 | 1 | 2);
    return c.json({ prediction: await saveLedgerRow(row) }, 200);
  } catch (e: any) { return c.json({ error: e?.message ?? "invalid resolution" }, 400); }
});

app.get("/sports/football/predictions/report", async (c) => { const minimum = Math.max(1, Number.parseInt(c.req.query("minimumResolved") ?? "100", 10) || 100); try { return c.json(reportFootballLedger(await listLedgerRows(), minimum), 200); } catch (e: any) { return c.json({ error: e?.message ?? "ledger report failed" }, 502); } });
app.get("/sports/football/predictions/:predictionId", async (c) => { try { const row = await getLedgerRow(c.req.param("predictionId")); return row ? c.json({ prediction: row }, 200) : c.json({ error: "prediction not found" }, 404); } catch (e: any) { return c.json({ error: e?.message ?? "ledger lookup failed" }, 502); } });

app.get("/sports/football/oos", async (c) => {
  const code = (c.req.query("league") ?? "E0").toUpperCase();
  const minTrain = Math.max(120, Number.parseInt(c.req.query("minTrain") ?? "120", 10) || 120);
  const minHoldout = Math.max(30, Number.parseInt(c.req.query("minHoldout") ?? "30", 10) || 30);
  try { const matches = await fetchFootball(code); const leagueName = FOOTBALL_LEAGUES[code]?.name ?? code; return c.json({ league: leagueName, ...evaluateFootballOos(leagueName, matches, { minTrain, minHoldout }) }, 200); }
  catch (e: any) { return c.json({ error: e?.message ?? "OOS evaluation failed" }, 502); }
});

app.get("/sports/football/fixtures", async (c) => {
  const code = (c.req.query("league") ?? "E0").toUpperCase(), today = c.req.query("today") || new Date().toISOString().slice(0, 10), days = Math.min(30, Math.max(1, parseInt(c.req.query("days") ?? "7", 10) || 7));
  try {
    const matches = await fetchFootball(code), teams = listTeams(matches);
    // Primeira Liga has no football.json feed; openfootball's Football.TXT
    // dataset for Portugal (europe/portugal) is the only free fixture source.
    const { fixtures, season } = code === "P1" ? await fetchPrimeiraLigaFixtures(teams) : await fetchFixtures(code, teams);
    const { list, offseason } = selectUpcoming(fixtures, today, days), leagueName = FOOTBALL_LEAGUES[code]?.name ?? code;
    const games = list.map((f) => { let prediction: any = null, error: string | null = null; if (f.home && f.away && f.home !== f.away) { try { prediction = predictFootball(leagueName, matches, f.home, f.away, { fixtureDate: f.date }); } catch (e: any) { error = e?.message ?? "no model"; } } else error = "team not mapped"; return { date: f.date, time: f.time, round: f.round, home: f.home ?? f.homeOpen, away: f.away ?? f.awayOpen, played: f.played, prediction, error }; });
    return c.json({ league: leagueName, season, offseason, count: games.length, games }, 200);
  } catch (e: any) { return c.json({ error: e?.message ?? "failed" }, 502); }
});

app.get("/sports/euro/predict", async (c) => {
  const home = c.req.query("home") ?? "", away = c.req.query("away") ?? "";
  if (!home || !away) return c.json({ error: "home e away são obrigatórios" }, 400);
  const requestedFixtureDate = c.req.query("fixtureDate")?.trim() ?? "";
  // Same as the domestic route: default to today when the caller (e.g. the
  // manual matchup simulator) doesn't send a date — never leaks future results.
  const fixtureDate = requestedFixtureDate || new Date().toISOString().slice(0, 10);
  try {
    const prediction = await predictCrossLeagueProduction(home, away, {
      fixtureDate,
      homeAttackMult: parseMultiplier(c.req.query("homeAttackMult")),
      homeDefMult: parseMultiplier(c.req.query("homeDefMult")),
      awayAttackMult: parseMultiplier(c.req.query("awayAttackMult")),
      awayDefMult: parseMultiplier(c.req.query("awayDefMult")),
      motivationFactor: parseMultiplier(c.req.query("motivationFactor")),
    });
    const ev: Record<string, number | null> = { home: null, draw: null, away: null };
    const homeOdds = parseFloat(c.req.query("homeOdds") ?? ""), drawOdds = parseFloat(c.req.query("drawOdds") ?? ""), awayOdds = parseFloat(c.req.query("awayOdds") ?? "");
    if (Number.isFinite(homeOdds) && homeOdds > 1) ev.home = +(prediction.probHome - 1 / homeOdds).toFixed(4);
    if (Number.isFinite(drawOdds) && drawOdds > 1) ev.draw = +(prediction.probDraw - 1 / drawOdds).toFixed(4);
    if (Number.isFinite(awayOdds) && awayOdds > 1) ev.away = +(prediction.probAway - 1 / awayOdds).toFixed(4);
    return c.json({ prediction: { ...prediction, ev, fixtureDateSource: requestedFixtureDate ? "explicit" : "today" } }, 200);
  } catch (e: any) { return c.json({ error: e?.message ?? "failed" }, 502); }
});

app.get("/sports/euro/fixtures", async (c) => {
  const key = c.req.query("key") ?? "wcup";
  const today = c.req.query("today") || new Date().toISOString().slice(0, 10);
  const days = Math.min(60, Math.max(1, parseInt(c.req.query("days") ?? "14", 10) || 14));
  try {
    // Champions/Europa League have a dedicated free fixture dataset
    // (openfootball/champions-league) with team names reconciled to the
    // Dixon-Coles model, so predict lookups succeed reliably. Fall back to
    // the ESPN scrape when it has nothing yet (e.g. Europa League's
    // league-phase file lags qualifiers early in the season).
    if (key === "ucl" || key === "uel") {
      const { teamLeague } = await fetchCrossLeagueDataProduction();
      const modelTeams = Object.keys(teamLeague);
      const free = key === "ucl" ? await fetchChampionsLeagueFixturesFree(modelTeams) : await fetchEuropaLeagueFixturesFree(modelTeams);
      if (free) {
        const { list, offseason } = selectUpcomingEuro(free, today, days);
        return c.json({ competition: key === "ucl" ? "Champions League" : "Liga Europa", offseason, count: list.length, games: list, source: "openfootball" }, 200);
      }
    }
    const fixtures = await fetchEuroFixtures(key);
    const { list, offseason } = selectUpcomingEuro(fixtures, today, days);
    const source = EURO_SOURCE_KEYS.find((s) => s.key === key);
    return c.json({ competition: source?.label ?? key, offseason, count: list.length, games: list, source: "espn" }, 200);
  } catch (e: any) { return c.json({ error: e?.message ?? "failed" }, 502); }
});

app.all("*", (c) => {
  let executionCtx: typeof c.executionCtx | undefined;
  try {
    executionCtx = c.executionCtx;
  } catch {
    executionCtx = undefined;
  }
  return legacyApp.fetch(c.req.raw, c.env, executionCtx);
});
export type AppType = typeof app;
export default app;
