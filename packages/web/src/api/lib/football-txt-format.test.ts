import { describe, expect, test } from "bun:test";
import { parseFootballTxt } from "./football-txt-format";

describe("parseFootballTxt", () => {
  test("parses rounds, dates, times, scores and country-suffixed team names", () => {
    const text = `
= UEFA Champions League 2025/26

# Date       Tue Sep 16 2025 - Sat May 30 2026 (256d)
# Teams      36
# Matches    189

▪ League, Matchday 1
  Tue Sep 16 2025
    18:45  Athletic Club (ESP)     v Arsenal FC (ENG)         0-2 (0-0)
           PSV (NED)               v Royale Union Saint-Gilloise (BEL)  1-3 (0-2)
    21:00  Juventus FC (ITA)       v Borussia Dortmund (GER)  4-4 (0-0)

▪ League, Matchday 2
  Tue Sep 30
    18:45  Atalanta BC (ITA)       v Club Brugge KV (BEL)     2-1 (0-1)
`;

    const matches = parseFootballTxt(text);
    expect(matches).toHaveLength(4);

    expect(matches[0]).toEqual({
      date: "2025-09-16",
      time: "18:45",
      round: "League, Matchday 1",
      team1: "Athletic Club",
      team2: "Arsenal FC",
      venue: null,
      score: { ft: [0, 2] },
    });

    // Continuation line with no repeated time prefix inherits the block's time.
    expect(matches[1].time).toBe("18:45");
    expect(matches[1].team1).toBe("PSV");
    expect(matches[1].team2).toBe("Royale Union Saint-Gilloise");
    expect(matches[1].score).toEqual({ ft: [1, 3] });

    expect(matches[2].time).toBe("21:00");

    // Date line without an explicit year: carries the season's current year forward.
    expect(matches[3].date).toBe("2025-09-30");
  });

  test("carries the implicit year across a Dec -> Jan season boundary", () => {
    const text = `
= Some Competition 2025/26

# Date       Fri Dec 12 2025 - Sat Feb 14 2026 (64d)
# Teams      4
# Matches    2

▪ Round 1
  Fri Dec 12 2025
    20:00  Team A v Team B  1-0
▪ Round 2
  Sat Jan 17
    20:00  Team C v Team D  2-2
`;
    const matches = parseFootballTxt(text);
    expect(matches[0].date).toBe("2025-12-12");
    expect(matches[1].date).toBe("2026-01-17"); // year rolled over, not stuck at 2025
  });

  test("handles unplayed fixtures (no score) and a venue-annotated line", () => {
    const text = `
= Friendly 2026

# Date       Mon Jun 1 2026 - Mon Jun 1 2026 (1d)
# Teams      2
# Matches    1

▪ Final
  Mon Jun 1 2026
    20:00  Team A v Team B  @ Wembley Stadium, London
`;
    const matches = parseFootballTxt(text);
    expect(matches).toHaveLength(1);
    expect(matches[0].score).toBeNull();
    expect(matches[0].venue).toBe("Wembley Stadium, London");
    expect(matches[0].team1).toBe("Team A");
    expect(matches[0].team2).toBe("Team B");
  });

  test("extracts the regulation/extra-time score from a penalty-shootout final line", () => {
    const text = `
= Final 2026

# Date       Sat May 30 2026 - Sat May 30 2026 (1d)
# Teams      2
# Matches    1

▪ Finals, Final
  Sat May 30
    18:00  Paris Saint-Germain FC v Arsenal FC (ENG)         4-3 pen. 1-1 a.e.t. (1-1, 0-1)
`;
    const matches = parseFootballTxt(text);
    expect(matches).toHaveLength(1);
    expect(matches[0].team1).toBe("Paris Saint-Germain FC");
    expect(matches[0].team2).toBe("Arsenal FC");
    expect(matches[0].score).toEqual({ ft: [4, 3] });
  });

  test("ignores goalscorer annotation lines and lines before the first date header", () => {
    const text = `
= Cup 2026

# Date       Tue Apr 1 2026 - Tue Apr 1 2026 (1d)
# Teams      2
# Matches    1

Group A |  Team X  Team Y

▪ Quarter-finals
  Tue Apr 1
    20:45   Team X        v Team Y  1-1
              (Someone 71'; Other 56')
`;
    const matches = parseFootballTxt(text);
    expect(matches).toHaveLength(1);
    expect(matches[0].team1).toBe("Team X");
    expect(matches[0].team2).toBe("Team Y");
  });
});
