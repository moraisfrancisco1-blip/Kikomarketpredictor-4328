// Football data-integrity helpers.
// These functions are deliberately independent from the prediction model so they
// can be tested and audited without changing model probabilities.

export type MatchLike = {
  date: string;
  home: string;
  away: string;
  hg?: number;
  ag?: number;
};

/**
 * Return the number of days since a team's latest match strictly BEFORE the
 * target fixture. Future matches are never allowed to affect the value.
 */
export function restDaysBeforeFixture(
  matches: MatchLike[],
  team: string,
  targetDate: string,
): number | undefined {
  const targetMs = new Date(targetDate).getTime();
  if (!Number.isFinite(targetMs)) return undefined;

  let latestMs = -Infinity;
  for (const match of matches) {
    const dateMs = new Date(match.date).getTime();
    if (!Number.isFinite(dateMs) || dateMs >= targetMs) continue;
    if (match.home !== team && match.away !== team) continue;
    if (dateMs > latestMs) latestMs = dateMs;
  }

  if (!Number.isFinite(latestMs)) return undefined;
  return Math.max(0, Math.round((targetMs - latestMs) / 86_400_000));
}

/**
 * Keep only matches whose results were already known at the prediction time.
 * This is useful whenever a historical dataset contains future fixtures or
 * when a live feed mixes played and unplayed rows.
 */
export function matchesKnownAt(
  matches: MatchLike[],
  targetDate: string,
): MatchLike[] {
  const targetMs = new Date(targetDate).getTime();
  if (!Number.isFinite(targetMs)) return [];
  return matches.filter((match) => {
    const dateMs = new Date(match.date).getTime();
    return Number.isFinite(dateMs) && dateMs < targetMs;
  });
}

/**
 * Conservative fixture-data gate. A model should not claim a strong prediction
 * when either team has too little prior history available at fixture time.
 */
export function hasMinimumPriorHistory(
  matches: MatchLike[],
  home: string,
  away: string,
  targetDate: string,
  minimumGames = 5,
): boolean {
  const prior = matchesKnownAt(matches, targetDate);
  const count = (team: string) =>
    prior.filter((m) => m.home === team || m.away === team).length;
  return count(home) >= minimumGames && count(away) >= minimumGames;
}
