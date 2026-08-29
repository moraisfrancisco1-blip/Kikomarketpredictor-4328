// Sports prediction — PURELY data-driven. NO bookmaker odds are used.
// We ignore every odds column in the source data on purpose.
//
// Football: football-data.co.uk CSVs (free, no key) -> full Dixon-Coles
// NBA / Tennis: TheSportsDB (free) -> Elo on past results

import { fitDixonColes, predictMatch, backtest, restDays, tuneHalfLife, predictOU, predictHandicap, predictAccumulator, backtestWithSamples, type DCMatch, type Backtest, type OUResult, type HandicapResult, type PredictOpts } from "./dixoncoles";
import { computeSportsConfidence } from "./tracker";
import { computeH2H, computeFatigue, computeImportance, type H2HSummary, type FatigueInfo, type GameImportance } from "./sports-enrichment";
export { fetchLeagueXG, type XGTeamStats } from "./sports-enrichment";

// ---------------- Football ----------------

export const FOOTBALL_LEAGUES: Record<string, { name: string; code: string }> = {
  E0:  { name: "Premier League",       code: "E0"  },
  SP1: { name: "La Liga",              code: "SP1" },
  D1:  { name: "Bundesliga",           code: "D1"  },
  I1:  { name: "Serie A",              code: "I1"  },
  F1:  { name: "Ligue 1",              code: "F1"  },
  P1:  { name: "Primeira Liga",        code: "P1"  },
};

// Several seasons: recency weighting down-weights the old ones, but a larger
// sample makes the Dixon-Coles fit and the backtest meaningful.
const SEASONS = ["2223", "2324", "2425", "2526"];

export type Match = {
  date: string;
  home: string;
  away: string;
  hg: number; // home goals
  ag: number; // away goals
};

const matchCache = new Map<string, { ts: number; matches: Match[] }>();
const TTL = 30 * 60 * 1000;

// football-data.co.uk uses dd/mm/yy or dd/mm/yyyy. Normalize to ISO yyyy-mm-dd.
function toIso(d: string): string {
  if (!d) return d;
  const parts = d.split(/[\/\-]/);
  if (parts.length !== 3) return d;
  let [dd, mm, yy] = parts;
  if (yy.length === 2) yy = (parseInt(yy, 10) > 50 ? "19" : "20") + yy;
  return `${yy}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")}`;
}

export async function fetchFootball(leagueCode: string): Promise<Match[]> {
  const cached = matchCache.get(leagueCode);
  if (cached && Date.now() - cached.ts < TTL) return cached.matches;

  const all: Match[] = [];
  for (const season of SEASONS) {
    const url = `https://www.football-data.co.uk/mmz4281/${season}/${leagueCode}.csv`;
    try {
      const res = await fetch(url);
      if (!res.ok) continue;
      const text = await res.text();
      const lines = text.trim().split("\n");
      const header = lines[0].split(",");
      const iDate = header.indexOf("Date");
      const iHome = header.indexOf("HomeTeam");
      const iAway = header.indexOf("AwayTeam");
      const iHG = header.indexOf("FTHG"); // full-time home goals
      const iAG = header.indexOf("FTAG");
      if (iHG < 0) continue;
      for (let i = 1; i < lines.length; i++) {
        const cols = lines[i].split(",");
        const home = cols[iHome];
        const away = cols[iAway];
        const hg = parseInt(cols[iHG], 10);
        const ag = parseInt(cols[iAG], 10);
        if (!home || !away || isNaN(hg) || isNaN(ag)) continue;
        all.push({ date: toIso(cols[iDate]), home, away, hg, ag });
      }
    } catch {
      /* skip season */
    }
  }
  matchCache.set(leagueCode, { ts: Date.now(), matches: all });
  return all;
}

// ---- Elo ratings from results ----
function buildElo(matches: Match[]) {
  const R: Record<string, number> = {};
  const K = 20;
  const HOME_ADV = 65;
  const get = (t: string) => R[t] ?? 1500;
  for (const m of matches) {
    const rh = get(m.home) + HOME_ADV;
    const ra = get(m.away);
    const exp = 1 / (1 + 10 ** ((ra - rh) / 400));
    const score = m.hg > m.ag ? 1 : m.hg === m.ag ? 0.5 : 0;
    // goal-difference multiplier
    const gd = Math.abs(m.hg - m.ag);
    const mult = gd <= 1 ? 1 : gd === 2 ? 1.5 : (11 + gd) / 8;
    const delta = K * mult * (score - exp);
    R[m.home] = get(m.home) + delta;
    R[m.away] = get(m.away) - delta;
  }
  return R;
}

// ---- Attack/Defense strengths for Poisson (Dixon-Coles lite) ----
function buildStrengths(matches: Match[]) {
  const teams = new Set<string>();
  matches.forEach((m) => {
    teams.add(m.home);
    teams.add(m.away);
  });
  let totHG = 0,
    totAG = 0;
  matches.forEach((m) => {
    totHG += m.hg;
    totAG += m.ag;
  });
  const n = matches.length || 1;
  const avgHome = totHG / n;
  const avgAway = totAG / n;

  const stats: Record<string, { hgF: number; hgA: number; agF: number; agA: number; hp: number; ap: number }> = {};
  for (const t of teams) stats[t] = { hgF: 0, hgA: 0, agF: 0, agA: 0, hp: 0, ap: 0 };
  for (const m of matches) {
    stats[m.home].hgF += m.hg;
    stats[m.home].hgA += m.ag;
    stats[m.home].hp += 1;
    stats[m.away].agF += m.ag;
    stats[m.away].agA += m.hg;
    stats[m.away].ap += 1;
  }
  const strength: Record<string, { attH: number; defH: number; attA: number; defA: number }> = {};
  for (const t of teams) {
    const s = stats[t];
    strength[t] = {
      attH: s.hp ? s.hgF / s.hp / avgHome : 1,
      defH: s.hp ? s.hgA / s.hp / avgAway : 1,
      attA: s.ap ? s.agF / s.ap / avgAway : 1,
      defA: s.ap ? s.agA / s.ap / avgHome : 1,
    };
  }
  return { strength, avgHome, avgAway };
}

function poissonPmf(k: number, lambda: number) {
  let f = 1;
  for (let i = 2; i <= k; i++) f *= i;
  return (Math.exp(-lambda) * lambda ** k) / f;
}

// Options for extended predictions (injuries, motivation, odds)
export type PredictExtOpts = {
  homeAttackMult?: number;  // 0.6–1.2
  homeDefMult?: number;
  awayAttackMult?: number;
  awayDefMult?: number;
  motivationFactor?: number; // 0.7–1.2
  neutral?: boolean;
};

export type FootballPrediction = {
  league: string;
  home: string;
  away: string;
  expHomeGoals: number;
  expAwayGoals: number;
  probHome: number;
  probDraw: number;
  probAway: number;
  over25: number;
  under25: number;
  bttsYes: number; // both teams to score
  topScores: { score: string; prob: number }[];
  eloHome: number;
  eloAway: number;
  homeAdv: number; // calibrated home goal multiplier (exp of fitted log home adv)
  rho: number; // Dixon-Coles low-score correlation
  halfLife: number; // auto-tuned recency half-life in days (validated by backtest)
  sample: number;
  ouLines: OUResult;     // over/under for 0.5–4.5
  formHome: string;      // last-5 form e.g. "WWDLW"
  formAway: string;
  confidence: number;    // 0..1 model confidence score
  isFriendly: boolean;   // friendly match penalty applied
  // Enriched features
  h2h: H2HSummary;
  fatigue: FatigueInfo;
  importanceHome: GameImportance;
  importanceAway: GameImportance;
  xgHome?: number;   // avg xG scored per game (from understat — may be undefined)
  xgAway?: number;
  // Walk-forward out-of-sample DC predictions — the ONLY valid XGBoost training set.
  // Each entry was predicted using only data PRIOR to that match (no circular leakage).
  historyWithProbs?: Array<{
    date: string; home: string; away: string; hg: number; ag: number;
    probHome: number; probDraw: number; probAway: number;
    eloHome: number; eloAway: number;
    outcome: 0 | 1 | 2; // 0=home, 1=draw, 2=away
  }>;
};

// Auto-tuned recency half-life per match set (validated by backtest log-loss).
// Cached because tuning runs several backtests and is relatively expensive.
const hlCache = new Map<string, { ts: number; hl: number }>();
function tunedHalfLife(matches: Match[]): number {
  if (matches.length < 200) return 180; // too few games to tune reliably
  const key = `${matches.length}:${matches[0]?.date}:${matches[matches.length - 1]?.date}`;
  const cached = hlCache.get(key);
  if (cached && Date.now() - cached.ts < TTL) return cached.hl;
  const dc: DCMatch[] = matches.map((m) => ({ date: m.date, home: m.home, away: m.away, hg: m.hg, ag: m.ag }));
  const t = tuneHalfLife(dc);
  hlCache.set(key, { ts: Date.now(), hl: t.halfLifeDays });
  return t.halfLifeDays;
}

// Compute last-N form string ("WWDLW") for a team from sorted match history
function teamForm(matches: Match[], team: string, n = 5): string {
  const played = matches
    .filter((m) => m.home === team || m.away === team)
    .sort((a, b) => (a.date < b.date ? -1 : 1));
  const last = played.slice(-n);
  return last.map((m) => {
    const isHome = m.home === team;
    if (m.hg === m.ag) return "D";
    if (isHome) return m.hg > m.ag ? "W" : "L";
    return m.ag > m.hg ? "W" : "L";
  }).join("") || "-";
}

export function predictFootball(leagueName: string, matches: Match[], home: string, away: string, extOpts: PredictExtOpts = {}): FootballPrediction {
  // Keep Elo only for a familiar strength readout in the UI.
  const elo = buildElo(matches);

  // Full Dixon-Coles fit (recency + calibrated home adv + rho).
  const dc: DCMatch[] = matches.map((m) => ({ date: m.date, home: m.home, away: m.away, hg: m.hg, ag: m.ag }));
  const hl = tunedHalfLife(matches);
  const model = fitDixonColes(dc, { halfLifeDays: hl });
  if (model.att[home] == null || model.att[away] == null) throw new Error("team not found in this league sample");

  const pred = predictMatch(model, home, away, {
    restHomeDays: restDays(model, home),
    restAwayDays: restDays(model, away),
    homeAttackMult: extOpts.homeAttackMult,
    homeDefMult: extOpts.homeDefMult,
    awayAttackMult: extOpts.awayAttackMult,
    awayDefMult: extOpts.awayDefMult,
    motivationFactor: extOpts.motivationFactor,
    neutral: extOpts.neutral,
  });

  const ouLines = predictOU(pred.expHomeGoals, pred.expAwayGoals, model.rho);
  const formHome = teamForm(matches, home, 5);
  const formAway = teamForm(matches, away, 5);

  return {
    league: leagueName,
    home,
    away,
    expHomeGoals: pred.expHomeGoals,
    expAwayGoals: pred.expAwayGoals,
    probHome: pred.probHome,
    probDraw: pred.probDraw,
    probAway: pred.probAway,
    over25: pred.over25,
    under25: pred.under25,
    bttsYes: pred.bttsYes,
    topScores: pred.topScores,
    eloHome: Math.round(elo[home] ?? 1500),
    eloAway: Math.round(elo[away] ?? 1500),
    homeAdv: +Math.exp(model.homeAdv).toFixed(2),
    rho: +model.rho.toFixed(3),
    halfLife: hl,
    sample: matches.length,
    ouLines,
    formHome,
    formAway,
    isFriendly: false,
    confidence: computeSportsConfidence({
      sample: matches.length,
      probWinner: Math.max(pred.probHome, pred.probDraw, pred.probAway),
      isFriendly: false,
      formAvailable: true,
      gamesHome: Math.round(matches.filter(m => m.home === home || m.away === home).length),
      gamesAway: Math.round(matches.filter(m => m.home === away || m.away === away).length),
    }),
    h2h: computeH2H(matches, home, away),
    fatigue: computeFatigue(matches, home, away, new Date().toISOString().split("T")[0]),
    importanceHome: computeImportance(matches, home, away).home,
    importanceAway: computeImportance(matches, home, away).away,
    // Walk-forward out-of-sample DC predictions as XGBoost training data.
    // Each match predicted using ONLY prior data — no circular leakage.
    // Result is cached per league (same key as backtest cache).
    historyWithProbs: getCachedWFSamples(leagueName, dc, hl),
  };
}

// Walk-forward backtest for a league. Cached so the UI can show measured skill.
// Cache for walk-forward training samples (expensive: refits DC model 20+ times)
const wfSamplesCache = new Map<string, { ts: number; samples: NonNullable<FootballPrediction["historyWithProbs"]> }>();
function getCachedWFSamples(code: string, dc: DCMatch[], hl: number): NonNullable<FootballPrediction["historyWithProbs"]> {
  const key = `${code}:${dc.length}:${dc[0]?.date}:${dc[dc.length - 1]?.date}`;
  const cached = wfSamplesCache.get(key);
  if (cached && Date.now() - cached.ts < TTL) return cached.samples;
  const samples = backtestWithSamples(dc, { halfLifeDays: hl, testFraction: 0.6, refitEvery: 25 });
  wfSamplesCache.set(key, { ts: Date.now(), samples });
  return samples;
}

const ftBtCache = new Map<string, { ts: number; bt: Backtest }>();
export function backtestFootball(code: string, matches: Match[]): Backtest {
  const cached = ftBtCache.get(code);
  if (cached && Date.now() - cached.ts < TTL) return cached.bt;
  const dc: DCMatch[] = matches.map((m) => ({ date: m.date, home: m.home, away: m.away, hg: m.hg, ag: m.ag }));
  const bt = backtest(dc, { halfLifeDays: tunedHalfLife(matches), testFraction: 0.3, refitEvery: 25 });
  ftBtCache.set(code, { ts: Date.now(), bt });
  return bt;
}

export function listTeams(matches: Match[]): string[] {
  const s = new Set<string>();
  matches.forEach((m) => {
    s.add(m.home);
    s.add(m.away);
  });
  return [...s].sort();
}

// ---------------- Fixtures (openfootball, free, no key) ----------------
// openfootball publishes the full season schedule (incl. unplayed matches).
// We map its long team names to the short football-data.co.uk names that the
// Dixon-Coles model is fitted on, so each fixture can be run through predictFootball.

// football-data.co.uk league code -> openfootball file code
const OPEN_CODE: Record<string, string> = {
  E0: "en.1",
  SP1: "es.1",
  D1: "de.1",
  I1: "it.1",
  F1: "fr.1",
};

// Canonicalize a team name: lowercase, strip accents, drop club suffixes/words,
// remove punctuation. Used to fuzzy-join the two naming schemes.
function canon(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // accents
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[.\-_'`]/g, " ")
    .replace(/\b(fc|cf|afc|ac|as|sc|ss|ssc|us|rc|rcd|ca|sv|vfb|vfl|tsg|fsv|ud|cd|cfc|club|calcio|balompie|de|futbol|football|1846|1899|1909|1907|1910|1913|1901|05|29|de madrid|de vigo|de barcelona)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Explicit overrides where canonicalization isn't enough (model name on the right
// is the football-data.co.uk short name).
const FIXTURE_NAME_OVERRIDE: Record<string, string> = {
  // England
  "manchester city": "Man City",
  "manchester united": "Man United",
  "tottenham hotspur": "Tottenham",
  "wolverhampton wanderers": "Wolves",
  "nottingham forest": "Nott'm Forest",
  "brighton hove albion": "Brighton",
  "leeds united": "Leeds",
  "newcastle united": "Newcastle",
  "west ham united": "West Ham",
  "bournemouth": "Bournemouth",
  // Spain
  "athletic": "Ath Bilbao",
  "atletico madrid": "Ath Madrid",
  "atletico": "Ath Madrid",
  "barcelona": "Barcelona",
  "real betis": "Betis",
  "celta": "Celta",
  "espanyol barcelona": "Espanol",
  "espanyol": "Espanol",
  "rayo vallecano madrid": "Vallecano",
  "rayo vallecano": "Vallecano",
  "real sociedad": "Sociedad",
  "alaves": "Alaves",
  "real oviedo": "Oviedo",
  "osasuna": "Osasuna",
  // Germany
  "heidenheim": "Heidenheim",
  "koln": "FC Koln",
  "union berlin": "Union Berlin",
  "mainz": "Mainz",
  "bayer leverkusen": "Leverkusen",
  "leverkusen": "Leverkusen",
  "borussia dortmund": "Dortmund",
  "borussia monchengladbach": "M'gladbach",
  "monchengladbach": "M'gladbach",
  "eintracht frankfurt": "Ein Frankfurt",
  "augsburg": "Augsburg",
  "bayern munchen": "Bayern Munich",
  "bayern": "Bayern Munich",
  "st pauli": "St Pauli",
  "hamburger": "Hamburg",
  "hamburg": "Hamburg",
  "freiburg": "Freiburg",
  "werder bremen": "Werder Bremen",
  "hoffenheim": "Hoffenheim",
  "stuttgart": "Stuttgart",
  "wolfsburg": "Wolfsburg",
  // Italy
  "milan": "Milan",
  "internazionale milano": "Inter",
  "inter": "Inter",
  "pisa": "Pisa",
  "fiorentina": "Fiorentina",
  "roma": "Roma",
  "atalanta": "Atalanta",
  "bologna": "Bologna",
  "cagliari": "Cagliari",
  "como": "Como",
  "genoa": "Genoa",
  "hellas verona": "Verona",
  "verona": "Verona",
  "juventus": "Juventus",
  "parma": "Parma",
  "lazio": "Lazio",
  "napoli": "Napoli",
  "torino": "Torino",
  "cremonese": "Cremonese",
  "lecce": "Lecce",
  "sassuolo": "Sassuolo",
  "udinese": "Udinese",
  // France
  "auxerre": "Auxerre",
  "monaco": "Monaco",
  "angers": "Angers",
  "lorient": "Lorient",
  "metz": "Metz",
  "nantes": "Nantes",
  "le havre": "Le Havre",
  "lille": "Lille",
  "nice": "Nice",
  "olympique lyonnais": "Lyon",
  "lyon": "Lyon",
  "olympique marseille": "Marseille",
  "marseille": "Marseille",
  "paris": "Paris FC",
  "paris saint germain": "Paris SG",
  "strasbourg alsace": "Strasbourg",
  "strasbourg": "Strasbourg",
  "racing lens": "Lens",
  "lens": "Lens",
  "stade brestois": "Brest",
  "brest": "Brest",
  "stade rennais": "Rennes",
  "rennes": "Rennes",
  "toulouse": "Toulouse",
};

// Map an openfootball name to the model's team name (or null if no confident match).
function mapToModelTeam(openName: string, modelTeams: string[]): string | null {
  const c = canon(openName);
  if (FIXTURE_NAME_OVERRIDE[c]) return FIXTURE_NAME_OVERRIDE[c];
  // canon-match against the model team list
  const byCanon = new Map<string, string>();
  for (const t of modelTeams) byCanon.set(canon(t), t);
  if (byCanon.has(c)) return byCanon.get(c)!;
  // containment fallback (e.g. "paris fc" canon "paris" vs model "Paris FC")
  for (const [tc, t] of byCanon) {
    if (tc && (tc.includes(c) || c.includes(tc))) return t;
  }
  return null;
}

export type Fixture = {
  date: string; // ISO yyyy-mm-dd
  time: string | null;
  round: string | null;
  homeOpen: string; // original openfootball name (for display fallback)
  awayOpen: string;
  home: string | null; // mapped model name (null = unmatched)
  away: string | null;
  played: boolean;
};

type OpenMatch = {
  round?: string;
  date: string;
  time?: string;
  team1: string;
  team2: string;
  score?: { ft?: number[]; ht?: number[] } | number[] | null;
};

/** Determine if an openfootball match has a final score.
 *  Two formats exist in the wild:
 *    { ft: [g, g], ht: [...] }  — standard
 *    [g, g]                     — legacy flat array (also means played)
 */
function isOpenMatchPlayed(score: OpenMatch["score"]): boolean {
  if (!score) return false;
  if (Array.isArray(score)) return score.length === 2; // [g, g]
  return !!(score.ft && score.ft.length === 2);        // { ft: [g, g] }
}

const fixtureCache = new Map<string, { ts: number; fixtures: Fixture[]; season: string }>();
const FIX_TTL = 15 * 60 * 1000;

// Try the current season, then the next one (when published). Returns the file
// that actually has unplayed matches, otherwise the most recent available.
async function fetchOpenSeason(openCode: string): Promise<{ matches: OpenMatch[]; season: string } | null> {
  // candidate seasons newest-first
  const candidates = ["2026-27", "2025-26", "2024-25"];
  let fallback: { matches: OpenMatch[]; season: string } | null = null;
  for (const season of candidates) {
    try {
      const res = await fetch(`https://raw.githubusercontent.com/openfootball/football.json/master/${season}/${openCode}.json`);
      if (!res.ok) continue;
      const json: any = await res.json();
      const matches: OpenMatch[] = json.matches ?? [];
      if (!matches.length) continue;
      const hasUnplayed = matches.some((m) => !isOpenMatchPlayed(m.score));
      if (hasUnplayed) return { matches, season };
      if (!fallback) fallback = { matches, season };
    } catch {
      /* try next */
    }
  }
  return fallback;
}

export async function fetchFixtures(leagueCode: string, modelTeams: string[]): Promise<{ fixtures: Fixture[]; season: string }> {
  const openCode = OPEN_CODE[leagueCode];
  if (!openCode) return { fixtures: [], season: "" };

  const cached = fixtureCache.get(leagueCode);
  if (cached && Date.now() - cached.ts < FIX_TTL) return { fixtures: cached.fixtures, season: cached.season };

  const data = await fetchOpenSeason(openCode);
  if (!data) return { fixtures: [], season: "" };

  const fixtures: Fixture[] = data.matches.map((m) => ({
    date: m.date,
    time: m.time ?? null,
    round: m.round ?? null,
    homeOpen: m.team1,
    awayOpen: m.team2,
    home: mapToModelTeam(m.team1, modelTeams),
    away: mapToModelTeam(m.team2, modelTeams),
    played: isOpenMatchPlayed(m.score),
  }));

  fixtureCache.set(leagueCode, { ts: Date.now(), fixtures, season: data.season });
  return { fixtures, season: data.season };
}

// Pick upcoming fixtures: unplayed matches from `today` forward. If the season is
// fully played (off-season), return the last round so the UI can show something.
export function selectUpcoming(fixtures: Fixture[], todayIso: string, days: number): { list: Fixture[]; offseason: boolean } {
  const upcoming = fixtures.filter((f) => !f.played && f.date >= todayIso).sort((a, b) => (a.date + (a.time ?? "")).localeCompare(b.date + (b.time ?? "")));
  if (upcoming.length) {
    // window: from the first upcoming date, include `days` of fixtures
    const first = upcoming[0].date;
    const end = new Date(first);
    end.setDate(end.getDate() + days);
    const endIso = end.toISOString().slice(0, 10);
    return { list: upcoming.filter((f) => f.date <= endIso), offseason: false };
  }
  // off-season: show the final matchday as a sample of how cards look
  const played = fixtures.filter((f) => f.played).sort((a, b) => b.date.localeCompare(a.date));
  const lastRound = played.length ? played[0].round : null;
  const list = lastRound ? played.filter((f) => f.round === lastRound) : played.slice(0, 10);
  return { list, offseason: true };
}

// -------- European club competitions + Friendlies (openfootball) --------
// openfootball also publishes Champions League, Europa League, Conference League,
// and international friendlies. We fetch these as "fixture-only" sources: we
// -------- Cross-League Model (for European competitions) --------
// We pool all domestic league data to build a single Dixon-Coles model.
// This lets us predict any club-vs-club match (UCL, UEL, UECL, friendlies)
// by using their domestic form as a proxy, with league-level intercepts
// so different league strengths don't distort the ratings.

export type EuroPrediction = {
  home: string;
  away: string;
  expHomeGoals: number;
  expAwayGoals: number;
  probHome: number;
  probDraw: number;
  probAway: number;
  over25: number;
  under25: number;
  bttsYes: number;
  topScores: { score: string; prob: number }[];
  eloHome: number;
  eloAway: number;
  rho: number;
  sample: number;
  leagueHome: string | null;
  leagueAway: string | null;
  ouLines: OUResult;
  formHome: string;
  formAway: string;
};

// Cross-league pool: fetch all leagues and aggregate
const crossLeagueCache: { ts: number; data: { matches: Match[]; teamLeague: Record<string, string> } } | null = null;
let _crossLeague: { ts: number; data: { matches: Match[]; teamLeague: Record<string, string> } } | null = null;

export async function fetchCrossLeagueData(): Promise<{ matches: Match[]; teamLeague: Record<string, string> }> {
  if (_crossLeague && Date.now() - _crossLeague.ts < TTL) return _crossLeague.data;

  const allLeagues = Object.keys(FOOTBALL_LEAGUES);
  const results = await Promise.allSettled(allLeagues.map((code) => fetchFootball(code)));

  const allMatches: Match[] = [];
  const teamLeague: Record<string, string> = {};

  results.forEach((r, i) => {
    if (r.status === "fulfilled") {
      const code = allLeagues[i];
      const leagueName = FOOTBALL_LEAGUES[code].name;
      r.value.forEach((m) => {
        allMatches.push(m);
        teamLeague[m.home] = leagueName;
        teamLeague[m.away] = leagueName;
      });
    }
  });

  _crossLeague = { ts: Date.now(), data: { matches: allMatches, teamLeague } };
  return _crossLeague.data;
}

export async function predictCrossLeague(home: string, away: string, extOpts: PredictExtOpts = {}): Promise<EuroPrediction> {
  const { matches, teamLeague } = await fetchCrossLeagueData();

  const elo = buildElo(matches);
  const dc: DCMatch[] = matches.map((m) => ({ date: m.date, home: m.home, away: m.away, hg: m.hg, ag: m.ag }));

  // Use a moderate half-life — cross-league form is broader, 120-day is good
  const model = fitDixonColes(dc, { halfLifeDays: 120 });

  if (model.att[home] == null) throw new Error(`Clube "${home}" não encontrado no modelo. Verifique o nome.`);
  if (model.att[away] == null) throw new Error(`Clube "${away}" não encontrado no modelo. Verifique o nome.`);

  // European games are played at neutral/away venues — no standard home advantage
  // We use the model's home advantage but reduce it by 40% for neutral-ish contexts
  const pred = predictMatch(model, home, away, {
    restHomeDays: restDays(model, home),
    restAwayDays: restDays(model, away),
    homeAttackMult: extOpts.homeAttackMult,
    homeDefMult: extOpts.homeDefMult,
    awayAttackMult: extOpts.awayAttackMult,
    awayDefMult: extOpts.awayDefMult,
    motivationFactor: extOpts.motivationFactor,
    neutral: extOpts.neutral,
  });

  const ouLines = predictOU(pred.expHomeGoals, pred.expAwayGoals, model.rho);
  const formHome = teamForm(matches, home, 5);
  const formAway = teamForm(matches, away, 5);

  return {
    home,
    away,
    expHomeGoals: pred.expHomeGoals,
    expAwayGoals: pred.expAwayGoals,
    probHome: pred.probHome,
    probDraw: pred.probDraw,
    probAway: pred.probAway,
    over25: pred.over25,
    under25: pred.under25,
    bttsYes: pred.bttsYes,
    topScores: pred.topScores,
    eloHome: Math.round(elo[home] ?? 1500),
    eloAway: Math.round(elo[away] ?? 1500),
    rho: +model.rho.toFixed(3),
    sample: matches.length,
    leagueHome: teamLeague[home] ?? null,
    leagueAway: teamLeague[away] ?? null,
    ouLines,
    formHome,
    formAway,
  };
}

// List all teams in the cross-league model
export async function listCrossLeagueTeams(): Promise<string[]> {
  const { matches } = await fetchCrossLeagueData();
  return listTeams(matches);
}

// Cross-league backtest (cached separately, slower because of large pool)
let _crossBt: { ts: number; bt: Backtest } | null = null;
export async function backtestCrossLeague(): Promise<Backtest> {
  if (_crossBt && Date.now() - _crossBt.ts < TTL) return _crossBt.bt;
  const { matches } = await fetchCrossLeagueData();
  const dc: DCMatch[] = matches.map((m) => ({ date: m.date, home: m.home, away: m.away, hg: m.hg, ag: m.ag }));
  const bt = backtest(dc, { halfLifeDays: 120, testFraction: 0.25, refitEvery: 50 });
  _crossBt = { ts: Date.now(), bt };
  return bt;
}

// show the fixture cards and run each team through predictFootball using the
// domestic league model (best available proxy when no separate UCL dataset exists).

export type EuroFixture = {
  date: string;          // ISO date "YYYY-MM-DD"
  time: string | null;   // "HH:MM" UTC
  round: string | null;
  home: string;
  away: string;
  homeLogo: string | null;
  awayLogo: string | null;
  venue: string | null;
  played: boolean;
  score: string | null;  // e.g. "2 - 1" for played matches
  competition: string;
};

// ESPN API slugs for each competition key
const ESPN_SOURCES: { key: string; label: string; slug: string }[] = [
  { key: "ucl",       label: "Champions League",       slug: "UEFA.CHAMPIONS"   },
  { key: "uel",       label: "Liga Europa",             slug: "UEFA.EUROPA"      },
  { key: "uecl",      label: "Liga Conferência",        slug: "UEFA.EUROPA.CONF" },
  { key: "wcup",      label: "Copa do Mundo 2026",      slug: "FIFA.WORLD"       },
  { key: "friendlies",label: "Amigáveis",               slug: "FIFA.FRIENDLY"    },
  { key: "nations",   label: "Nations League",          slug: "UEFA.NATIONS"     },
];

const ESPN_BASE = "https://site.api.espn.com/apis/site/v2/sports/soccer";
const EURO_TTL = 10 * 60 * 1000;
const euroCache = new Map<string, { ts: number; fixtures: EuroFixture[] }>();

function espnDateRange(daysBack = 7, daysAhead = 90): string {
  const from = new Date();
  from.setDate(from.getDate() - daysBack);
  const to = new Date();
  to.setDate(to.getDate() + daysAhead);
  const fmt = (d: Date) =>
    `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
  return `${fmt(from)}-${fmt(to)}`;
}

export async function fetchEuroFixtures(key: string): Promise<EuroFixture[]> {
  const cached = euroCache.get(key);
  if (cached && Date.now() - cached.ts < EURO_TTL) return cached.fixtures;

  const source = ESPN_SOURCES.find((s) => s.key === key);
  if (!source) return [];

  try {
    // Fetch a wide window: 3 days back → 120 days ahead. Keep daysBack small so
    // the 200-event limit isn't consumed by past results before reaching today.
    const range = espnDateRange(3, 120);
    const url = `${ESPN_BASE}/${source.slug}/scoreboard?dates=${range}&limit=200`;
    const res = await fetch(url);
    if (!res.ok) return [];
    const json: any = await res.json();

    const fixtures: EuroFixture[] = (json.events ?? []).map((event: any) => {
      const comp = (event.competitions ?? [])[0] ?? {};
      const competitors: any[] = comp.competitors ?? [];
      const home = competitors.find((c: any) => c.homeAway === "home");
      const away = competitors.find((c: any) => c.homeAway === "away");
      const status = comp.status?.type ?? {};
      const played = status.completed === true || status.state === "post";
      const homeScore = played && home ? home.score : null;
      const awayScore = played && away ? away.score : null;
      const score = played && homeScore != null ? `${homeScore} - ${awayScore}` : null;

      const dateObj = new Date(event.date);
      const dateIso = dateObj.toISOString().slice(0, 10);
      const timeUtc = `${String(dateObj.getUTCHours()).padStart(2, "0")}:${String(dateObj.getUTCMinutes()).padStart(2, "0")}`;

      // Round / stage from season slug or notes
      const round = event.season?.slug
        ? event.season.slug.replace(/-/g, " ").replace(/\b\w/g, (c: string) => c.toUpperCase())
        : null;

      return {
        date: dateIso,
        time: timeUtc,
        round,
        home: home?.team?.displayName ?? event.name.split(" at ")[1] ?? "?",
        away: away?.team?.displayName ?? event.name.split(" at ")[0] ?? "?",
        homeLogo: home?.team?.logo ?? null,
        awayLogo: away?.team?.logo ?? null,
        venue: comp.venue?.fullName ?? null,
        played,
        score,
        competition: source.label,
      } as EuroFixture;
    });

    // Sort ascending by date
    fixtures.sort((a, b) => a.date.localeCompare(b.date) || (a.time ?? "").localeCompare(b.time ?? ""));
    euroCache.set(key, { ts: Date.now(), fixtures });
    return fixtures;
  } catch {
    return [];
  }
}

export function selectUpcomingEuro(
  fixtures: EuroFixture[],
  todayIso: string,
  days: number,
): { list: EuroFixture[]; offseason: boolean } {
  const upcoming = fixtures.filter((f) => !f.played && f.date >= todayIso);
  if (upcoming.length) {
    // Show matches from the first upcoming date up to first+days
    const firstDate = upcoming[0].date;
    const cutoff = new Date(firstDate);
    cutoff.setDate(cutoff.getDate() + days);
    const endIso = cutoff.toISOString().slice(0, 10);
    return { list: upcoming.filter((f) => f.date <= endIso), offseason: false };
  }
  // Off-season: return last 10 played results
  const played = fixtures.filter((f) => f.played).slice(-10);
  return { list: played, offseason: true };
}

export const EURO_SOURCE_KEYS = ESPN_SOURCES.map((s) => ({ key: s.key, label: s.label }));

// ---------------- NBA / Tennis (TheSportsDB, Elo) ----------------

const SDB_BASE = "https://www.thesportsdb.com/api/v1/json/3";
const SDB_LEAGUES: Record<string, { id: string; name: string }> = {
  nba: { id: "4387", name: "NBA" },
};

export type GameResult = { date: string; home: string; away: string; hs: number; as: number };

const sdbCache = new Map<string, { ts: number; games: GameResult[] }>();

// Pull several seasons to build a usable sample. The free TheSportsDB key
// returns limited rows per call, so we stitch multiple season endpoints.
export async function fetchSdbResults(key: string): Promise<GameResult[]> {
  const cached = sdbCache.get(key);
  if (cached && Date.now() - cached.ts < TTL) return cached.games;
  const league = SDB_LEAGUES[key];
  if (!league) throw new Error("unknown league");

  const seasons = ["2024-2025", "2025-2026"];
  const seen = new Set<string>();
  const games: GameResult[] = [];

  // recent past results
  const sources = [
    `${SDB_BASE}/eventspastleague.php?id=${league.id}`,
    ...seasons.map((s) => `${SDB_BASE}/eventsseason.php?id=${league.id}&s=${s}`),
  ];

  for (const url of sources) {
    try {
      const res = await fetch(url);
      if (!res.ok) continue;
      const json: any = await res.json();
      for (const e of json.events ?? []) {
        const hs = parseInt(e.intHomeScore, 10);
        const as = parseInt(e.intAwayScore, 10);
        if (!e.strHomeTeam || !e.strAwayTeam || isNaN(hs) || isNaN(as)) continue;
        const id = e.idEvent ?? `${e.dateEvent}-${e.strHomeTeam}`;
        if (seen.has(id)) continue;
        seen.add(id);
        games.push({ date: e.dateEvent, home: e.strHomeTeam, away: e.strAwayTeam, hs, as });
      }
    } catch {
      /* skip source */
    }
  }
  games.sort((a, b) => (a.date || "").localeCompare(b.date || ""));
  sdbCache.set(key, { ts: Date.now(), games });
  return games;
}

export function predictGameElo(games: GameResult[], home: string, away: string) {
  const R: Record<string, number> = {};
  const K = 20;
  const HOME_ADV = 100; // points-based sports, larger home edge in Elo space
  const get = (t: string) => R[t] ?? 1500;
  for (const g of games) {
    const rh = get(g.home) + HOME_ADV;
    const ra = get(g.away);
    const exp = 1 / (1 + 10 ** ((ra - rh) / 400));
    const score = g.hs > g.as ? 1 : 0;
    const delta = K * (score - exp);
    R[g.home] = get(g.home) + delta;
    R[g.away] = get(g.away) - delta;
  }
  const rh = get(home) + HOME_ADV;
  const ra = get(away);
  const probHome = 1 / (1 + 10 ** ((ra - rh) / 400));
  return {
    home,
    away,
    probHome,
    probAway: 1 - probHome,
    eloHome: Math.round(get(home)),
    eloAway: Math.round(get(away)),
    sample: games.length,
  };
}

export function listGameTeams(games: GameResult[]): string[] {
  const s = new Set<string>();
  games.forEach((g) => {
    s.add(g.home);
    s.add(g.away);
  });
  return [...s].sort();
}

// ---------------- International / National teams (World Cup) ----------------
// Source: martj42/international_results (free, no key) — every men's
// international result since 1872. We honor the `neutral` flag and weight
// competitive matches above friendlies. NO bookmaker odds, ever.

export type IntlMatch = {
  date: string;
  home: string;
  away: string;
  hg: number;
  ag: number;
  neutral: boolean;
  tournament: string;
};

const INTL_URL = "https://raw.githubusercontent.com/martj42/international_results/master/results.csv";
// Only use recent history so current squad strength dominates.
const INTL_FROM = "2021-01-01";
let intlCache: { ts: number; matches: IntlMatch[] } | null = null;

// Simple CSV parser (handles quoted fields with commas).
function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else q = false;
      } else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === ",") {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

export async function fetchInternational(): Promise<IntlMatch[]> {
  if (intlCache && Date.now() - intlCache.ts < TTL) return intlCache.matches;
  const res = await fetch(INTL_URL);
  if (!res.ok) throw new Error("could not load international results");
  const text = await res.text();
  const lines = text.trim().split("\n");
  const header = parseCsvLine(lines[0]);
  const iDate = header.indexOf("date");
  const iHome = header.indexOf("home_team");
  const iAway = header.indexOf("away_team");
  const iHG = header.indexOf("home_score");
  const iAG = header.indexOf("away_score");
  const iTour = header.indexOf("tournament");
  const iNeu = header.indexOf("neutral");
  const all: IntlMatch[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = parseCsvLine(lines[i]);
    const date = cols[iDate];
    if (!date || date < INTL_FROM) continue;
    const home = cols[iHome];
    const away = cols[iAway];
    const hg = parseInt(cols[iHG], 10);
    const ag = parseInt(cols[iAG], 10);
    if (!home || !away || isNaN(hg) || isNaN(ag)) continue; // skips future "NA" fixtures
    all.push({
      date,
      home,
      away,
      hg,
      ag,
      neutral: (cols[iNeu] || "").toUpperCase() === "TRUE",
      tournament: cols[iTour] || "",
    });
  }
  intlCache = { ts: Date.now(), matches: all };
  return all;
}

export function listIntlTeams(matches: IntlMatch[]): string[] {
  const s = new Set<string>();
  matches.forEach((m) => {
    s.add(m.home);
    s.add(m.away);
  });
  return [...s].sort();
}

// Elo for national teams. Honors neutral venue (no home advantage) and
// weights competitive matches above friendlies via the K-factor.
function buildIntlElo(matches: IntlMatch[]) {
  const R: Record<string, number> = {};
  const HOME_ADV = 60;
  const get = (t: string) => R[t] ?? 1500;
  for (const m of matches) {
    const adv = m.neutral ? 0 : HOME_ADV;
    const rh = get(m.home) + adv;
    const ra = get(m.away);
    const exp = 1 / (1 + 10 ** ((ra - rh) / 400));
    const score = m.hg > m.ag ? 1 : m.hg === m.ag ? 0.5 : 0;
    const isFriendly = /friendly/i.test(m.tournament);
    const baseK = isFriendly ? 12 : 32; // World Cup / qualifiers matter more
    const gd = Math.abs(m.hg - m.ag);
    const mult = gd <= 1 ? 1 : gd === 2 ? 1.5 : (11 + gd) / 8;
    const delta = baseK * mult * (score - exp);
    R[m.home] = get(m.home) + delta;
    R[m.away] = get(m.away) - delta;
  }
  return R;
}

// Attack/defense strengths, but venue-agnostic (national teams play few
// home games), using overall goals for/against per match.
function buildIntlStrengths(matches: IntlMatch[]) {
  const teams = new Set<string>();
  let totGoals = 0;
  matches.forEach((m) => {
    teams.add(m.home);
    teams.add(m.away);
    totGoals += m.hg + m.ag;
  });
  const avgGoals = totGoals / (matches.length * 2 || 1); // avg goals scored per team per match
  const stats: Record<string, { gf: number; ga: number; p: number }> = {};
  for (const t of teams) stats[t] = { gf: 0, ga: 0, p: 0 };
  for (const m of matches) {
    stats[m.home].gf += m.hg;
    stats[m.home].ga += m.ag;
    stats[m.home].p += 1;
    stats[m.away].gf += m.ag;
    stats[m.away].ga += m.hg;
    stats[m.away].p += 1;
  }
  const strength: Record<string, { att: number; def: number; games: number }> = {};
  for (const t of teams) {
    const s = stats[t];
    strength[t] = {
      att: s.p ? s.gf / s.p / avgGoals : 1,
      def: s.p ? s.ga / s.p / avgGoals : 1,
      games: s.p,
    };
  }
  return { strength, avgGoals };
}

export type IntlPrediction = {
  home: string;
  away: string;
  neutral: boolean;
  expHomeGoals: number;
  expAwayGoals: number;
  probHome: number;
  probDraw: number;
  probAway: number;
  over25: number;
  under25: number;
  bttsYes: number;
  topScores: { score: string; prob: number }[];
  eloHome: number;
  eloAway: number;
  rho: number;
  gamesHome: number;
  gamesAway: number;
  sample: number;
  ouLines: OUResult;
  formHome: string;
  formAway: string;
  confidence: number;    // 0..1 model confidence score
  isFriendly: boolean;   // detected from tournament name
  h2h: H2HSummary;
  importanceHome: GameImportance;
  importanceAway: GameImportance;
};

// Competitive matches (qualifiers, finals) are more informative than friendlies.
function intlWeight(tournament: string): number {
  return /friendly/i.test(tournament) ? 0.5 : 1;
}

export function predictInternational(
  matches: IntlMatch[],
  home: string,
  away: string,
  neutral: boolean,
  extOpts: PredictExtOpts = {},
): IntlPrediction {
  const elo = buildIntlElo(matches);

  // Dixon-Coles fit. Honor neutral venue per-match and weight competitive games.
  const dc: DCMatch[] = matches.map((m) => ({
    date: m.date,
    home: m.home,
    away: m.away,
    hg: m.hg,
    ag: m.ag,
    neutral: m.neutral,
    weight: intlWeight(m.tournament),
  }));
  // Longer half-life: international samples are thin, so we keep more history.
  const model = fitDixonColes(dc, { halfLifeDays: 540 });
  if (model.att[home] == null || model.att[away] == null) throw new Error("team not found in international sample");

  const pred = predictMatch(model, home, away, {
    neutral,
    homeAttackMult: extOpts.homeAttackMult,
    homeDefMult: extOpts.homeDefMult,
    awayAttackMult: extOpts.awayAttackMult,
    awayDefMult: extOpts.awayDefMult,
    motivationFactor: extOpts.motivationFactor,
  });

  const gamesHome = Math.round(model.games[home] ?? 0);
  const gamesAway = Math.round(model.games[away] ?? 0);

  // For international, build form from IntlMatch array (treat as Match-compatible)
  const intlAsMatch: Match[] = matches.map((m) => ({ date: m.date, home: m.home, away: m.away, hg: m.hg, ag: m.ag }));
  const ouLines = predictOU(pred.expHomeGoals, pred.expAwayGoals, model.rho);
  const formHome = teamForm(intlAsMatch, home, 5);
  const formAway = teamForm(intlAsMatch, away, 5);

  // Detect if it's likely a friendly context (majority of recent head-to-head are friendlies)
  const h2h = matches.filter(m => (m.home === home && m.away === away) || (m.home === away && m.away === home));
  const recentH2H = h2h.slice(-5);
  const friendlyRatio = recentH2H.length > 0
    ? recentH2H.filter(m => /friendly/i.test(m.tournament)).length / recentH2H.length
    : 0;
  const isFriendly = friendlyRatio > 0.5;

  const confidence = computeSportsConfidence({
    sample: matches.length,
    probWinner: Math.max(pred.probHome, pred.probDraw, pred.probAway),
    isFriendly,
    formAvailable: true,
    gamesHome,
    gamesAway,
  });

  return {
    home,
    away,
    neutral,
    expHomeGoals: pred.expHomeGoals,
    expAwayGoals: pred.expAwayGoals,
    probHome: pred.probHome,
    probDraw: pred.probDraw,
    probAway: pred.probAway,
    over25: pred.over25,
    under25: pred.under25,
    bttsYes: pred.bttsYes,
    topScores: pred.topScores,
    eloHome: Math.round(elo[home] ?? 1500),
    eloAway: Math.round(elo[away] ?? 1500),
    rho: +model.rho.toFixed(3),
    gamesHome,
    gamesAway,
    sample: matches.length,
    ouLines,
    formHome,
    formAway,
    confidence,
    isFriendly,
    h2h: computeH2H(intlAsMatch, home, away),
    importanceHome: { level: "normal", label: "Seleção Nacional", motivationMultiplier: 1.08, description: "Jogos internacionais têm motivação elevada" },
    importanceAway: { level: "normal", label: "Seleção Nacional", motivationMultiplier: 1.08, description: "Jogos internacionais têm motivação elevada" },
  };
}

let intlBtCache: { ts: number; bt: Backtest } | null = null;
export function backtestInternational(matches: IntlMatch[]): Backtest {
  if (intlBtCache && Date.now() - intlBtCache.ts < TTL) return intlBtCache.bt;
  const dc: DCMatch[] = matches.map((m) => ({
    date: m.date,
    home: m.home,
    away: m.away,
    hg: m.hg,
    ag: m.ag,
    neutral: m.neutral,
    weight: intlWeight(m.tournament),
  }));
  const bt = backtest(dc, { halfLifeDays: 540, testFraction: 0.25, refitEvery: 40 });
  intlBtCache = { ts: Date.now(), bt };
  return bt;
}
