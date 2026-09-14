/**
 * Leakage-safe temporal helpers for football predictions.
 *
 * Production predictions must use the fixture date, never the current clock,
 * when deriving rest/congestion information.
 */

export function normalizeFixtureDate(value?: string | Date): string {
  const date = value instanceof Date ? value : new Date(value ?? "");
  if (!Number.isFinite(date.getTime())) {
    throw new Error("invalid fixture date");
  }
  return date.toISOString();
}

export function fixtureDateOrUndefined(value?: string | Date): string | undefined {
  if (value == null) return undefined;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : undefined;
}

/**
 * Return true when a fixture date is explicitly supplied and valid.
 * Callers can use this to avoid silently substituting today's date.
 */
export function hasExplicitFixtureDate(value?: string | Date): boolean {
  return fixtureDateOrUndefined(value) !== undefined;
}
