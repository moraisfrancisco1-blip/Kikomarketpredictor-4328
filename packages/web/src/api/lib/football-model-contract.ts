/**
 * Contract for contextual football adjustments.
 *
 * Context is optional and bounded. A missing source must never manufacture
 * information, and contextual multipliers are deliberately conservative.
 */

export type FootballContextAdjustment = {
  homeAttackMult?: number;
  homeDefMult?: number;
  awayAttackMult?: number;
  awayDefMult?: number;
  motivationFactor?: number;
  sourceCount?: number;
  warnings?: string[];
};

const MIN_MULT = 0.94;
const MAX_MULT = 1.06;
const MIN_MOTIVATION = 0.97;
const MAX_MOTIVATION = 1.03;

export function clampFootballContextAdjustment(
  input: FootballContextAdjustment = {},
): FootballContextAdjustment {
  const clamp = (v: number | undefined, min: number, max: number) =>
    v == null || !Number.isFinite(v) ? undefined : Math.max(min, Math.min(max, v));

  return {
    homeAttackMult: clamp(input.homeAttackMult, MIN_MULT, MAX_MULT),
    homeDefMult: clamp(input.homeDefMult, MIN_MULT, MAX_MULT),
    awayAttackMult: clamp(input.awayAttackMult, MIN_MULT, MAX_MULT),
    awayDefMult: clamp(input.awayDefMult, MIN_MULT, MAX_MULT),
    motivationFactor: clamp(input.motivationFactor, MIN_MOTIVATION, MAX_MOTIVATION),
    sourceCount: Math.max(0, Math.floor(input.sourceCount ?? 0)),
    warnings: [...(input.warnings ?? [])],
  };
}

/**
 * Context alone is never allowed to create a directional prediction.
 * It may only make a small, auditable adjustment to the statistical core.
 */
export function emptyFootballContext(): FootballContextAdjustment {
  return { sourceCount: 0, warnings: [] };
}
