// Free, keyless GitHub-hosted fixture sources from the openfootball project
// (github.com/openfootball). Used for competitions/leagues that have no CSV
// (football-data.co.uk) or JSON (openfootball/football.json) feed:
//   - Portuguese Primeira Liga: no football.json entry at all (fixtures were
//     previously always empty for P1).
//   - Champions League / Europa League: no dedicated results feed of their
//     own anywhere in this app; fixtures came only from an ESPN scoreboard
//     scrape with no guarantee its team display names line up with the
//     football-data.co.uk names the Dixon-Coles model is fitted on.
// Both are Football.TXT format (see football-txt-format.ts), parsed and then
// reconciled to the model's team names with the same mapToModelTeam() logic
// already used for the JSON-sourced domestic leagues.

import { parseFootballTxt, type FootballTxtMatch } from "./football-txt-format.js";
import { mapToModelTeam, type Fixture, type EuroFixture } from "./sports-legacy.js";

const TTL = 15 * 60 * 1000;

// European club seasons run roughly Aug -> May. "2025-26" style naming.
function currentSeasonStart(): number {
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth() + 1;
  return m >= 7 ? y : y - 1;
}

function seasonLabel(startYear: number): string {
  return `${startYear}-${String((startYear + 1) % 100).padStart(2, "0")}`;
}

// Newest-first candidates, mirroring fetchOpenSeason's fallback strategy.
function seasonCandidates(): string[] {
  const start = currentSeasonStart();
  return [seasonLabel(start), seasonLabel(start - 1)];
}

async function fetchText(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

// A season file's last match date is always that season's final matchday,
// whether the season is brand new (mostly unplayed, far in the future) or
// long finished (every match played, months in the past). That — not "does
// it have any unplayed row" — is what actually tells current from stale: a
// handful of unfilled rows in an otherwise-finished season (the maintainer
// hasn't logged the final's result yet) would otherwise look "current"
// forever.
export function isRecentOrUpcoming(matches: FootballTxtMatch[], graceDays = 21): boolean {
  if (!matches.length) return false;
  const maxDate = matches.reduce((max, m) => (m.date > max ? m.date : max), matches[0]!.date);
  const cutoff = new Date(`${maxDate}T00:00:00Z`).getTime() + graceDays * 24 * 60 * 60 * 1000;
  return Date.now() <= cutoff;
}

// Try each season candidate; prefer the first one that's actually current
// (see isRecentOrUpcoming). `allowStaleFallback` controls what happens when
// none is: true keeps the newest stale season anyway (Primeira Liga has no
// better source, so showing last season's final round beats nothing), false
// returns null so the caller can fall back to a fresher source instead
// (Champions/Europa League have ESPN as a live alternative).
async function fetchSeasonTxt(urlFor: (season: string) => string, opts: { allowStaleFallback?: boolean } = {}): Promise<{ matches: FootballTxtMatch[]; season: string } | null> {
  const allowStaleFallback = opts.allowStaleFallback ?? true;
  let staleFallback: { matches: FootballTxtMatch[]; season: string } | null = null;
  for (const season of seasonCandidates()) {
    const text = await fetchText(urlFor(season));
    if (!text) continue;
    const matches = parseFootballTxt(text);
    if (!matches.length) continue;
    if (isRecentOrUpcoming(matches)) return { matches, season };
    if (!staleFallback) staleFallback = { matches, season };
  }
  return allowStaleFallback ? staleFallback : null;
}

const rawCache = new Map<string, { ts: number; data: { matches: FootballTxtMatch[]; season: string } | null }>();
async function cachedSeasonTxt(cacheKey: string, urlFor: (season: string) => string, opts: { allowStaleFallback?: boolean } = {}) {
  const cached = rawCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < TTL) return cached.data;
  const data = await fetchSeasonTxt(urlFor, opts);
  rawCache.set(cacheKey, { ts: Date.now(), data });
  return data;
}

// ---- Portuguese Primeira Liga (no football.json entry; .txt only) ----

export async function fetchPrimeiraLigaFixtures(modelTeams: string[]): Promise<{ fixtures: Fixture[]; season: string }> {
  const data = await cachedSeasonTxt(
    "pt1",
    (season) => `https://raw.githubusercontent.com/openfootball/europe/master/portugal/${season}_pt1.txt`,
  );
  if (!data) return { fixtures: [], season: "" };
  const fixtures: Fixture[] = data.matches.map((m) => ({
    date: m.date,
    time: m.time,
    round: m.round,
    homeOpen: m.team1,
    awayOpen: m.team2,
    home: mapToModelTeam(m.team1, modelTeams),
    away: mapToModelTeam(m.team2, modelTeams),
    played: m.score != null,
  }));
  return { fixtures, season: data.season };
}

// ---- Champions League / Europa League ----

function toEuroFixtures(matches: FootballTxtMatch[], modelTeams: string[], competitionLabel: string): EuroFixture[] {
  return matches
    .map((m): EuroFixture => {
      const home = mapToModelTeam(m.team1, modelTeams) ?? m.team1;
      const away = mapToModelTeam(m.team2, modelTeams) ?? m.team2;
      return {
        date: m.date,
        time: m.time,
        round: m.round,
        home,
        away,
        homeLogo: null,
        awayLogo: null,
        venue: m.venue,
        played: m.score != null,
        score: m.score ? `${m.score.ft[0]} - ${m.score.ft[1]}` : null,
        competition: competitionLabel,
      };
    })
    .sort((a, b) => a.date.localeCompare(b.date) || (a.time ?? "").localeCompare(b.time ?? ""));
}

/**
 * Champions League fixtures from openfootball's dedicated dataset. Returns
 * null (not an empty array) when the source has nothing for this season yet,
 * so callers can tell "no data available" apart from "no upcoming fixtures"
 * and fall back to the ESPN scrape.
 */
export async function fetchChampionsLeagueFixturesFree(modelTeams: string[]): Promise<EuroFixture[] | null> {
  const data = await cachedSeasonTxt(
    "cl",
    (season) => `https://raw.githubusercontent.com/openfootball/champions-league/master/${season}/cl.txt`,
    { allowStaleFallback: false },
  );
  if (!data) return null;
  return toEuroFixtures(data.matches, modelTeams, "Champions League");
}

/**
 * Europa League fixtures. Note: openfootball only publishes the league-phase
 * file (el.txt) once the season is well underway — early in a season only
 * qualifying rounds (elq.txt, not used here) exist yet. Returns null in that
 * window so callers fall back to ESPN until el.txt is published.
 */
export async function fetchEuropaLeagueFixturesFree(modelTeams: string[]): Promise<EuroFixture[] | null> {
  const data = await cachedSeasonTxt(
    "el",
    (season) => `https://raw.githubusercontent.com/openfootball/champions-league/master/${season}/el.txt`,
    { allowStaleFallback: false },
  );
  if (!data) return null;
  return toEuroFixtures(data.matches, modelTeams, "Liga Europa");
}
