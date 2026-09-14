import { clampFootballContextAdjustment, type FootballContextAdjustment } from "./football-model-contract";

export type FootballEvidence = {
  type: "injury" | "suspension" | "lineup" | "news" | "rest" | "motivation";
  team?: "home" | "away";
  direction?: -1 | 0 | 1;
  impact?: number;
  confidence?: number;
  sourceQuality?: number;
  publishedAt?: string;
};

function recencyWeight(publishedAt?: string, now = Date.now()): number {
  if (!publishedAt) return 0.5;
  const t = new Date(publishedAt).getTime();
  if (!Number.isFinite(t) || t > now) return 0.25;
  const hours = Math.max(0, (now - t) / 3_600_000);
  return Math.exp(-hours / 48);
}

function boundedSignal(e: FootballEvidence, now: number): number {
  const impact = Number.isFinite(e.impact ?? NaN) ? Math.max(0, Math.min(1, e.impact!)) : 0;
  const confidence = Number.isFinite(e.confidence ?? NaN) ? Math.max(0, Math.min(1, e.confidence!)) : 0;
  const quality = Number.isFinite(e.sourceQuality ?? NaN) ? Math.max(0, Math.min(1, e.sourceQuality!)) : 0.5;
  const direction = e.direction ?? 0;
  return direction * impact * confidence * quality * recencyWeight(e.publishedAt, now);
}

/**
 * Convert structured evidence into a tiny bounded adjustment. This is the
 * interface for an AI analyst: the analyst can rank evidence, but it cannot
 * bypass these hard limits or create probabilities directly.
 */
export function buildFootballAIContext(
  evidence: FootballEvidence[],
  now = Date.now(),
): FootballContextAdjustment {
  const homeSignals = evidence.filter((e) => e.team === "home").map((e) => boundedSignal(e, now));
  const awaySignals = evidence.filter((e) => e.team === "away").map((e) => boundedSignal(e, now));
  const home = homeSignals.reduce((a, b) => a + b, 0);
  const away = awaySignals.reduce((a, b) => a + b, 0);

  const homeEdge = Math.max(-1, Math.min(1, home - away));
  const awayEdge = -homeEdge;
  const sourceCount = evidence.filter((e) => boundedSignal(e, now) !== 0).length;

  const warnings: string[] = [];
  if (!evidence.length) warnings.push("no contextual evidence supplied");
  if (sourceCount < 2) warnings.push("weak contextual evidence");

  return clampFootballContextAdjustment({
    homeAttackMult: 1 + homeEdge * 0.06,
    awayAttackMult: 1 + awayEdge * 0.06,
    homeDefMult: 1 - homeEdge * 0.04,
    awayDefMult: 1 - awayEdge * 0.04,
    motivationFactor: 1 + homeEdge * 0.02,
    sourceCount,
    warnings,
  });
}

export function canUseAIContext(evidence: FootballEvidence[], minimumSources = 2): boolean {
  return evidence.filter((e) => boundedSignal(e) !== 0).length >= minimumSources;
}
