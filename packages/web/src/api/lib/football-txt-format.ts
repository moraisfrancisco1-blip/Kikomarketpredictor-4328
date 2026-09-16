// Parser for the openfootball "Football.TXT" format used by, e.g.,
// github.com/openfootball/champions-league and github.com/openfootball/europe.
// Format reference: https://github.com/openfootball/spec
//
// Example fragment:
//   ▪ League, Matchday 1
//     Tue Sep 16 2025
//       18:45  Athletic Club (ESP)     v Arsenal FC (ENG)         0-2 (0-0)
//              PSV (NED)               v Royale Union Saint-Gilloise (BEL)  1-3 (0-2)

export type FootballTxtMatch = {
  date: string; // ISO yyyy-mm-dd
  time: string | null;
  round: string | null;
  team1: string; // country-code suffix stripped, e.g. "Real Madrid CF" not "Real Madrid CF (ESP)"
  team2: string;
  venue: string | null;
  score: { ft: [number, number] } | null;
};

const MONTHS: Record<string, number> = {
  Jan: 1, Feb: 2, Mar: 3, Apr: 4, May: 5, Jun: 6,
  Jul: 7, Aug: 8, Sep: 9, Oct: 10, Nov: 11, Dec: 12,
};

const DATE_LINE_RE = /^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{1,2})(?:\s+(\d{4}))?$/;
const SEASON_HEADER_RE = /^#\s*Date\s+\w{3}\s+(\w{3})\s+\d{1,2}\s+(\d{4})/m;
// Anchored at the end for the common case ("...  2-1 (1-1)"). Extra-time /
// penalty-shootout finals append trailing notation after the score (e.g.
// "4-3 pen. 1-1 a.e.t. (1-1, 0-1)"), so fall back to an unanchored search —
// the first "N-N" after 2+ spaces is always the full-time (or a.e.t.) score.
const SCORE_SUFFIX_RE = /\s{2,}(\d+)-(\d+)(?:\s*\((\d+)-(\d+)\))?\s*$/;
const SCORE_ANYWHERE_RE = /\s{2,}(\d+)-(\d+)/;

function stripCountrySuffix(name: string): string {
  return name.replace(/\s*\([A-Za-z][A-Za-z.\s]{0,15}\)\s*$/, "").trim();
}

export function parseFootballTxt(text: string): FootballTxtMatch[] {
  const matches: FootballTxtMatch[] = [];

  // Seed the year from the "# Date  Tue Sep 16 2025 - ..." header. Most date
  // lines inside the body omit the year once it's established for the season.
  let currentYear: number | null = null;
  const headerMatch = SEASON_HEADER_RE.exec(text);
  if (headerMatch) currentYear = Number(headerMatch[2]);

  let currentDate: string | null = null;
  let currentRound: string | null = null;
  let currentTime: string | null = null;
  let lastMonth: number | null = null;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    if (line.startsWith("=") || line.startsWith("#")) continue;

    if (line.startsWith("▪")) {
      currentRound = line.replace(/^▪\s*/, "") || null;
      currentTime = null;
      continue;
    }

    const dateMatch = DATE_LINE_RE.exec(line);
    if (dateMatch) {
      const month = MONTHS[dateMatch[1]!]!;
      const day = Number(dateMatch[2]);
      const explicitYear = dateMatch[3] ? Number(dateMatch[3]) : null;
      if (explicitYear != null) currentYear = explicitYear;
      // A season spans a new-year boundary (e.g. Aug 2025 -> May 2026). A
      // large backward jump in month (Dec -> Jan) without an explicit year
      // means the implicit year rolled forward.
      else if (currentYear != null && lastMonth != null && month < lastMonth - 6) currentYear += 1;
      lastMonth = month;
      const year = currentYear ?? new Date().getUTCFullYear();
      currentDate = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      currentTime = null;
      continue;
    }

    if (!currentDate) continue; // preamble / table-of-contents lines before the first date

    let rest = line;
    const timeMatch = /^(\d{1,2}:\d{2})\s+(.*)$/.exec(rest);
    if (timeMatch) {
      currentTime = timeMatch[1]!;
      rest = timeMatch[2]!;
    }

    const vIdx = rest.search(/\sv\s/);
    if (vIdx === -1) continue; // goalscorer annotation or other non-match line

    const team1Raw = rest.slice(0, vIdx).trim();
    let afterV = rest.slice(vIdx).replace(/^\s*v\s*/, "");

    let venue: string | null = null;
    const atIdx = afterV.search(/\s@\s/);
    if (atIdx !== -1) {
      venue = afterV.slice(atIdx).replace(/^\s*@\s*/, "").trim() || null;
      afterV = afterV.slice(0, atIdx);
    }

    let team2Raw: string;
    let score: FootballTxtMatch["score"] = null;
    const scoreMatch = SCORE_SUFFIX_RE.exec(afterV) ?? SCORE_ANYWHERE_RE.exec(afterV);
    if (scoreMatch) {
      team2Raw = afterV.slice(0, scoreMatch.index).trim();
      score = { ft: [Number(scoreMatch[1]), Number(scoreMatch[2])] };
    } else {
      team2Raw = afterV.trim();
    }

    const team1 = stripCountrySuffix(team1Raw);
    const team2 = stripCountrySuffix(team2Raw);
    if (!team1 || !team2) continue;

    matches.push({ date: currentDate, time: currentTime, round: currentRound, team1, team2, venue, score });
  }

  return matches;
}
