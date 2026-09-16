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

// Try each season candidate; prefer one with at least one unplayed fixture
// (i.e. still relevant), otherwise keep the first successfully fetched season
// as a fallback so an off-season still shows the last completed round.
async function fetchSeasonTxt(urlFor: (season: string) => string): Promise<{ matches: FootballTxtMatch[]; season: string } | null> {
  let fallback: { matches: FootballTxtMatch[]; season: string } | null = null;
  for (const season of seasonCandidates()) {
    const text = await fetchText(urlFor(season));
    if (!text) continue;
    const matches = parseFootballTxt(text);
    if (!matches.length) continue;
    const hasUnplayed = matches.some((m) => !m.score);
    if (hasUnplayed) return { matches, season };
    if (!fallback) fallback = { matches, season };
  }
  return fallback;
}

const rawCache = new Map<string, { ts: number; data: { matches: FootballTxtMatch[]; season: string } | null }>();
async function cachedSeasonTxt(cacheKey: string, urlFor: (season: string) => string) {
  const cached = rawCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < TTL) return cached.data;
  const data = await fetchSeasonTxt(urlFor);
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
  );
  if (!data) return null;
  return toEuroFixtures(data.matches, modelTeams, "Liga Europa");
}
