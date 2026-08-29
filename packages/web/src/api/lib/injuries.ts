/**
 * Injury & suspension data fetcher
 * Sources: Sofascore unofficial (no key) → API-Football free tier (100 req/day)
 */

export interface InjuredPlayer {
  name: string;
  reason: string;
  status: string; // "absent" | "doubtful" | "suspended"
}

export interface InjuryReport {
  eventId: number;
  home: InjuredPlayer[];
  away: InjuredPlayer[];
  sources: string[];
  fetchedAt: string;
}

const ML_SERVICE = "http://localhost:4201";

/**
 * Fetch injuries from Python ML microservice (which handles Sofascore + API-Football)
 */
export async function fetchInjuries(eventId: number): Promise<InjuryReport | null> {
  try {
    const res = await fetch(`${ML_SERVICE}/injuries/${eventId}?source=both`, {
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return { ...data, fetchedAt: new Date().toISOString() };
  } catch {
    return null;
  }
}

/**
 * Search for Sofascore event ID given team names and date (for display purposes).
 * Returns null if not found — injury panel simply hides itself.
 */
export async function searchSofascoreEventId(
  homeTeam: string,
  awayTeam: string,
  date?: string
): Promise<number | null> {
  // Sofascore search endpoint (unofficial, no key)
  const query = encodeURIComponent(`${homeTeam} ${awayTeam}`);
  try {
    const res = await fetch(
      `https://api.sofascore.com/api/v1/search/events?q=${query}`,
      {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
          Accept: "application/json",
          Referer: "https://www.sofascore.com/",
        },
        signal: AbortSignal.timeout(6000),
      }
    );
    if (!res.ok) return null;
    const data = await res.json();
    const events = data?.results ?? [];
    if (events.length === 0) return null;
    // Return first match
    return events[0]?.entity?.id ?? null;
  } catch {
    return null;
  }
}

/** Summarize injury impact (for UI badge) */
export function injuryImpactLabel(
  report: InjuryReport,
  side: "home" | "away"
): string {
  const count = report[side].length;
  if (count === 0) return "Plantel completo";
  if (count === 1) return "1 ausência";
  return `${count} ausências`;
}
