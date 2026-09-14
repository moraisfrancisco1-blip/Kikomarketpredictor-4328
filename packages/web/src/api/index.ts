import { Hono } from "hono";
import { cors } from "hono/cors";
import legacyApp from "./index-legacy";
import {
  FOOTBALL_LEAGUES,
  fetchFootball,
  predictFootball,
  listTeams,
  fetchFixtures,
  selectUpcoming,
} from "./lib/sports";

const app = new Hono()
  .basePath("api")
  .use(cors({ origin: (origin) => origin ?? "*", credentials: true, exposeHeaders: ["set-auth-token"] }));

const parseMultiplier = (value: string | undefined, def = 1) => {
  const n = parseFloat(value ?? "");
  return Number.isFinite(n) ? Math.max(0.3, Math.min(1.8, n)) : def;
};

app.get("/sports/football/predict", async (c) => {
  const code = (c.req.query("league") ?? "E0").toUpperCase();
  const home = c.req.query("home") ?? "";
  const away = c.req.query("away") ?? "";
  if (!home || !away) return c.json({ error: "home and away required" }, 400);
  if (home === away) return c.json({ error: "pick two different teams" }, 400);
  try {
    const matches = await fetchFootball(code);
    const leagueName = FOOTBALL_LEAGUES[code]?.name ?? code;
    const prediction = predictFootball(leagueName, matches, home, away, {
      fixtureDate: c.req.query("fixtureDate") ?? undefined,
      homeAttackMult: parseMultiplier(c.req.query("homeAttackMult"), 1),
      homeDefMult: parseMultiplier(c.req.query("homeDefMult"), 1),
      awayAttackMult: parseMultiplier(c.req.query("awayAttackMult"), 1),
      awayDefMult: parseMultiplier(c.req.query("awayDefMult"), 1),
      motivationFactor: parseMultiplier(c.req.query("motivationFactor"), 1),
    });
    const ev: Record<string, number | null> = { home: null, draw: null, away: null };
    const homeOdds = parseFloat(c.req.query("homeOdds") ?? "");
    const drawOdds = parseFloat(c.req.query("drawOdds") ?? "");
    const awayOdds = parseFloat(c.req.query("awayOdds") ?? "");
    if (Number.isFinite(homeOdds) && homeOdds > 1) ev.home = +(prediction.probHome - 1 / homeOdds).toFixed(4);
    if (Number.isFinite(drawOdds) && drawOdds > 1) ev.draw = +(prediction.probDraw - 1 / drawOdds).toFixed(4);
    if (Number.isFinite(awayOdds) && awayOdds > 1) ev.away = +(prediction.probAway - 1 / awayOdds).toFixed(4);
    return c.json({ prediction: { ...prediction, ev } }, 200);
  } catch (e: any) {
    return c.json({ error: e?.message ?? "failed" }, 502);
  }
});

app.get("/sports/football/fixtures", async (c) => {
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
          prediction = predictFootball(leagueName, matches, f.home, f.away, { fixtureDate: f.date });
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
    return c.json({ error: e?.message ?? "failed" }, 502);
  }
});

// Preserve every existing endpoint and handler not explicitly overridden above.
app.all("*", (c) => legacyApp.fetch(c.req.raw, c.env, c.executionCtx));

export type AppType = typeof app;
export default app;
