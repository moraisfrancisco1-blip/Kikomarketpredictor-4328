import { Hono } from "hono";
import { cors } from "hono/cors";
import legacyApp from "./index-legacy";
import { FOOTBALL_LEAGUES, fetchFootball, predictFootball, listTeams, fetchFixtures, selectUpcoming } from "./lib/sports";
import { recordFootballPrediction, reportFootballLedger, resolveFootballPrediction } from "./lib/football-prediction-ledger";
import { getFootballPrediction, listFootballPredictions, saveFootballPrediction } from "./lib/football-prediction-ledger-store";
import { getFootballPredictionDb, listFootballPredictionsDb, saveFootballPredictionDb } from "./lib/football-prediction-ledger-db";
import { evaluateFootballOos } from "./lib/football-oos-validation";

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
  const code = (c.req.query("league") ?? "E0").toUpperCase(), home = c.req.query("home") ?? "", away = c.req.query("away") ?? "", fixtureDate = c.req.query("fixtureDate") ?? "";
  if (!home || !away) return c.json({ error: "home and away required" }, 400);
  if (home === away) return c.json({ error: "pick two different teams" }, 400);
  if (!fixtureDate) return c.json({ error: "fixtureDate is required for a leakage-safe prediction" }, 400);
  try {
    const matches = await fetchFootball(code), leagueName = FOOTBALL_LEAGUES[code]?.name ?? code;
    const prediction = predictFootball(leagueName, matches, home, away, { fixtureDate, homeAttackMult: parseMultiplier(c.req.query("homeAttackMult")), homeDefMult: parseMultiplier(c.req.query("homeDefMult")), awayAttackMult: parseMultiplier(c.req.query("awayAttackMult")), awayDefMult: parseMultiplier(c.req.query("awayDefMult")), motivationFactor: parseMultiplier(c.req.query("motivationFactor")) });
    const ev: Record<string, number | null> = { home: null, draw: null, away: null };
    const homeOdds = parseFloat(c.req.query("homeOdds") ?? ""), drawOdds = parseFloat(c.req.query("drawOdds") ?? ""), awayOdds = parseFloat(c.req.query("awayOdds") ?? "");
    if (Number.isFinite(homeOdds) && homeOdds > 1) ev.home = +(prediction.probHome - 1 / homeOdds).toFixed(4);
    if (Number.isFinite(drawOdds) && drawOdds > 1) ev.draw = +(prediction.probDraw - 1 / drawOdds).toFixed(4);
    if (Number.isFinite(awayOdds) && awayOdds > 1) ev.away = +(prediction.probAway - 1 / awayOdds).toFixed(4);
    return c.json({ prediction: { ...prediction, ev } }, 200);
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
    const matches = await fetchFootball(code), teams = listTeams(matches), { fixtures, season } = await fetchFixtures(code, teams), { list, offseason } = selectUpcoming(fixtures, today, days), leagueName = FOOTBALL_LEAGUES[code]?.name ?? code;
    const games = list.map((f) => { let prediction: any = null, error: string | null = null; if (f.home && f.away && f.home !== f.away) { try { prediction = predictFootball(leagueName, matches, f.home, f.away, { fixtureDate: f.date }); } catch (e: any) { error = e?.message ?? "no model"; } } else error = "team not mapped"; return { date: f.date, time: f.time, round: f.round, home: f.home ?? f.homeOpen, away: f.away ?? f.awayOpen, played: f.played, prediction, error }; });
    return c.json({ league: leagueName, season, offseason, count: games.length, games }, 200);
  } catch (e: any) { return c.json({ error: e?.message ?? "failed" }, 502); }
});

app.all("*", (c) => legacyApp.fetch(c.req.raw, c.env, c.executionCtx));
export type AppType = typeof app;
export default app;
