// Sports enrichment module — xG, injuries, H2H, importance, fatigue
// All data from FREE keyless sources only.
// ─── xG data (understat via openfootball JSON approximation) ──────────────────

const XG_CACHE = new Map<string, { ts: number; data: XGTeamStats }>();
const XG_TTL = 60 * 60 * 1000; // 1h

export type XGTeamStats = {
  team: string;
  xgFor: number;   // avg xG scored per match
  xgAgainst: number; // avg xG conceded per match
  sample: number;
};

// Understat JSON feeds — free, no key. Returns null if unavailable.
// Leagues: epl, la_liga, bundesliga, serie_a, ligue_1, rfpl
const UNDERSTAT_LEAGUE_MAP: Record<string, string> = {
  E0: "epl",
  SP1: "la_liga",
  D1: "bundesliga",
  I1: "serie_a",
  F1: "ligue_1",
};

// Fetch team xG stats for a league season from understat
export async function fetchLeagueXG(leagueCode: string): Promise<Map<string, XGTeamStats>> {
  const uLeague = UNDERSTAT_LEAGUE_MAP[leagueCode];
  if (!uLeague) return new Map();

  const year = new Date().getFullYear();
  const seasons = [year - 1, year - 2];
  const allStats = new Map<string, { xgFor: number; xgAgainst: number; n: number }>();

  for (const season of seasons) {
    try {
      const url = `https://understat.com/league/${uLeague}/${season}`;
      const res = await fetch(url, {
        headers: { "User-Agent": "Mozilla/5.0 (compatible; MarketPredictor/1.0)" },
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) continue;
      const html = await res.text();
      // Extract teamsData JSON from script tag
      const match = html.match(/teamsData\s*=\s*JSON\.parse\('([^']+)'\)/);
      if (!match) continue;
      const raw = JSON.parse(match[1].replace(/\\x([0-9A-Fa-f]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16))));
      for (const team of Object.values(raw) as any[]) {
        const name = team.title as string;
        const history = team.history as any[];
        if (!history?.length) continue;
        let xgF = 0, xgA = 0;
        for (const h of history) {
          xgF += parseFloat(h.xG) || 0;
          xgA += parseFloat(h.xGA) || 0;
        }
        const existing = allStats.get(name) ?? { xgFor: 0, xgAgainst: 0, n: 0 };
        allStats.set(name, {
          xgFor: existing.xgFor + xgF,
          xgAgainst: existing.xgAgainst + xgA,
          n: existing.n + history.length,
        });
      }
    } catch {
      // understat unavailable - skip
    }
  }

  const result = new Map<string, XGTeamStats>();
  for (const [team, s] of allStats) {
    if (s.n === 0) continue;
    result.set(team, {
      team,
      xgFor: +(s.xgFor / s.n).toFixed(3),
      xgAgainst: +(s.xgAgainst / s.n).toFixed(3),
      sample: s.n,
    });
  }
  return result;
}

// ─── H2H History ─────────────────────────────────────────────────────────────

export type H2HRecord = {
  date: string;
  home: string;
  away: string;
  hg: number;
  ag: number;
  result: "H" | "D" | "A"; // from home team perspective
};

export type H2HSummary = {
  total: number;
  homeWins: number;
  draws: number;
  awayWins: number;
  avgGoalsHome: number;
  avgGoalsAway: number;
  last5: H2HRecord[];
  dominance: "home" | "away" | "balanced"; // who dominates H2H
  dominanceScore: number; // -1..1 (positive = home dominates)
};

export function computeH2H(
  matches: { date: string; home: string; away: string; hg: number; ag: number }[],
  teamA: string,
  teamB: string,
): H2HSummary {
  // All meetings regardless of venue
  const h2h: H2HRecord[] = matches
    .filter(
      (m) =>
        (m.home === teamA && m.away === teamB) ||
        (m.home === teamB && m.away === teamA),
    )
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((m) => {
      const fromHomeTeamA = m.home === teamA;
      const aGoals = fromHomeTeamA ? m.hg : m.ag;
      const bGoals = fromHomeTeamA ? m.ag : m.hg;
      return {
        date: m.date,
        home: m.home,
        away: m.away,
        hg: m.hg,
        ag: m.ag,
        result:
          aGoals > bGoals ? "H" : aGoals === bGoals ? "D" : "A" as "H" | "D" | "A",
      };
    });

  const total = h2h.length;
  if (total === 0) {
    return {
      total: 0,
      homeWins: 0,
      draws: 0,
      awayWins: 0,
      avgGoalsHome: 0,
      avgGoalsAway: 0,
      last5: [],
      dominance: "balanced",
      dominanceScore: 0,
    };
  }

  // ── Recency-weighted H2H dominance ───────────────────────────────────────
  // Half-life: 3 years (1095 days). More recent meetings matter more.
  const H2H_HALF_LIFE_DAYS = 1095;
  const xi = Math.log(2) / H2H_HALF_LIFE_DAYS;
  const newest = h2h[h2h.length - 1].date;
  const newestMs = new Date(newest).getTime();

  let wHome = 0, wDraw = 0, wAway = 0, wTotal = 0;
  let wGoalsHome = 0, wGoalsAway = 0;

  for (const m of h2h) {
    const daysAgo = Math.max(0, (newestMs - new Date(m.date).getTime()) / 86_400_000);
    const w = Math.exp(-xi * daysAgo);
    wTotal += w;
    wGoalsHome += w * m.hg;
    wGoalsAway += w * m.ag;
    if (m.result === "H") wHome += w;
    else if (m.result === "D") wDraw += w;
    else wAway += w;
  }

  // Raw counts for display
  const homeWins = h2h.filter((m) => m.result === "H").length;
  const draws = h2h.filter((m) => m.result === "D").length;
  const awayWins = h2h.filter((m) => m.result === "A").length;
  const avgGoalsHome = wTotal > 0 ? +(wGoalsHome / wTotal).toFixed(2) : 0;
  const avgGoalsAway = wTotal > 0 ? +(wGoalsAway / wTotal).toFixed(2) : 0;

  // Weighted dominance score: +1 = home always wins (recency-weighted), -1 = away
  const dominanceScore = wTotal > 0 ? +((wHome - wAway) / wTotal).toFixed(2) : 0;
  const dominance =
    Math.abs(dominanceScore) < 0.2
      ? "balanced"
      : dominanceScore > 0
      ? "home"
      : "away";

  return {
    total,
    homeWins,
    draws,
    awayWins,
    avgGoalsHome,
    avgGoalsAway,
    last5: h2h.slice(-5),
    dominance,
    dominanceScore,
  };
}

// ─── Fatigue / Rest Days ──────────────────────────────────────────────────────

export type FatigueInfo = {
  homeRestDays: number | null; // days since last match (null if unknown)
  awayRestDays: number | null;
  homeFatigued: boolean; // < 4 days rest
  awayFatigued: boolean;
  homeMultiplier: number; // apply to attack (0.85–1.0)
  awayMultiplier: number;
};

export function computeFatigue(
  matches: { date: string; home: string; away: string }[],
  homeTeam: string,
  awayTeam: string,
  matchDate: string,
): FatigueInfo {
  const targetMs = new Date(matchDate).getTime();

  function lastMatchDate(team: string): Date | null {
    const prev = matches
      .filter(
        (m) =>
          (m.home === team || m.away === team) &&
          new Date(m.date).getTime() < targetMs,
      )
      .sort((a, b) => b.date.localeCompare(a.date));
    return prev.length ? new Date(prev[0].date) : null;
  }

  const lastHome = lastMatchDate(homeTeam);
  const lastAway = lastMatchDate(awayTeam);
  const target = new Date(matchDate);

  const homeRest = lastHome
    ? Math.round((target.getTime() - lastHome.getTime()) / 86400000)
    : null;
  const awayRest = lastAway
    ? Math.round((target.getTime() - lastAway.getTime()) / 86400000)
    : null;

  const homeFatigued = homeRest != null && homeRest < 4;
  const awayFatigued = awayRest != null && awayRest < 4;

  // Fatigue hits attack: < 4 days → 0.88, < 3 days → 0.82
  const fatigueMultiplier = (rest: number | null) => {
    if (rest == null) return 1.0;
    if (rest < 3) return 0.82;
    if (rest < 4) return 0.88;
    return 1.0;
  };

  return {
    homeRestDays: homeRest,
    awayRestDays: awayRest,
    homeFatigued,
    awayFatigued,
    homeMultiplier: fatigueMultiplier(homeRest),
    awayMultiplier: fatigueMultiplier(awayRest),
  };
}

// ─── Game Importance / Motivation ────────────────────────────────────────────

export type GameImportance = {
  level: "title" | "ucl" | "relegation" | "normal" | "dead_rubber";
  label: string;
  motivationMultiplier: number; // 0.85–1.15
  description: string;
};

// Compute position in table and derive importance
export function computeImportance(
  matches: { date: string; home: string; away: string; hg: number; ag: number }[],
  homeTeam: string,
  awayTeam: string,
  totalTeams = 20,
): { home: GameImportance; away: GameImportance } {
  // Build mini standings from most recent 15 matches for each team
  const recentMatches = matches.slice(-200);
  const pts: Record<string, number> = {};
  const played: Record<string, number> = {};

  for (const m of recentMatches) {
    pts[m.home] = pts[m.home] ?? 0;
    pts[m.away] = pts[m.away] ?? 0;
    played[m.home] = (played[m.home] ?? 0) + 1;
    played[m.away] = (played[m.away] ?? 0) + 1;
    if (m.hg > m.ag) { pts[m.home] += 3; }
    else if (m.hg === m.ag) { pts[m.home] += 1; pts[m.away] += 1; }
    else { pts[m.away] += 3; }
  }

  const standings = Object.keys(pts)
    .filter((t) => (played[t] ?? 0) >= 5)
    .sort((a, b) => (pts[b] ?? 0) - (pts[a] ?? 0));

  function classify(team: string): GameImportance {
    const pos = standings.indexOf(team) + 1; // 1 = top
    const n = standings.length || totalTeams;
    const pct = pos / n;
    const teamPts = pts[team] ?? 0;
    const leaderPts = pts[standings[0]] ?? 0;
    const gap = leaderPts - teamPts;
    const relegZone = n - 3; // bottom 3

    if (pos <= 2 && gap <= 6) return { level: "title", label: "Luta pelo título", motivationMultiplier: 1.12, description: "Equipa em disputa direta pelo título" };
    if (pos <= 4 && gap <= 9) return { level: "ucl", label: "Lugar UEFA", motivationMultiplier: 1.06, description: "Corrida por vagas europeias" };
    if (pos >= relegZone) return { level: "relegation", label: "Luta contra descida", motivationMultiplier: 1.10, description: "Zona de despromoção" };
    if (gap > 20 && pos > n * 0.6) return { level: "dead_rubber", label: "Sem nada em jogo", motivationMultiplier: 0.90, description: "Equipa sem objetivos na tabela" };
    return { level: "normal", label: "Jogo normal", motivationMultiplier: 1.00, description: "" };
  }

  return { home: classify(homeTeam), away: classify(awayTeam) };
}

