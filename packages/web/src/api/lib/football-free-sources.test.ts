import { describe, expect, test } from "bun:test";
import { isRecentOrUpcoming } from "./football-free-sources";
import type { FootballTxtMatch } from "./football-txt-format";

function match(date: string, score: FootballTxtMatch["score"] = null): FootballTxtMatch {
  return { date, time: null, round: null, team1: "A", team2: "B", venue: null, score };
}

describe("isRecentOrUpcoming", () => {
  test("rejects a season that finished months ago, even with a few unplayed rows left", () => {
    // Mirrors the real bug: the 2025-26 Champions League file's final was
    // never filled in with a result, so a naive "any unplayed match" check
    // treated a season that ended in May as still "current" in September.
    const finishedSeason: FootballTxtMatch[] = [
      match("2025-09-16", { ft: [1, 0] }),
      match("2026-04-08", { ft: [0, 2] }),
      match("2026-05-30", null), // final's result never logged
    ];
    expect(isRecentOrUpcoming(finishedSeason)).toBe(false);
  });

  test("accepts a season whose final matchday is still far in the future", () => {
    const now = new Date();
    const future = new Date(now.getTime() + 200 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const ongoingSeason: FootballTxtMatch[] = [
      match(new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10), { ft: [2, 1] }),
      match(future, null),
    ];
    expect(isRecentOrUpcoming(ongoingSeason)).toBe(true);
  });

  test("accepts a season that ended just within the grace window", () => {
    const recentEnd = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    expect(isRecentOrUpcoming([match(recentEnd, { ft: [1, 1] })], 21)).toBe(true);
  });

  test("returns false for an empty match list", () => {
    expect(isRecentOrUpcoming([])).toBe(false);
  });
});
