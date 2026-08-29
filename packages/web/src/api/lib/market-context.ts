import type { EarningsInfo, SentimentResult } from "./market-enrichment";

export type ContextAdjustedPrediction = {
  probabilityUp: number;
  probabilityDown: number;
  probabilityFlat: number;
  confidence: number;
  sentimentAdjustment: number;
  earningsPenalty: number;
  contextNotes: string[];
};

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

/**
 * Applies a deliberately small news/sentiment adjustment to a technical forecast.
 * News is capped so a single headline cannot overpower the technical model.
 */
export function applyMarketContext(
  technical: { probabilityUp: number; probabilityDown: number; probabilityFlat: number; confidence: number },
  sentiment: SentimentResult,
  earnings: EarningsInfo,
): ContextAdjustedPrediction {
  const notes: string[] = [];

  const articleReliability = clamp(sentiment.articleCount / 6, 0, 1);
  const sentimentAdjustment = clamp(sentiment.score * articleReliability * 0.08, -0.08, 0.08);

  let probabilityUp = technical.probabilityUp + sentimentAdjustment;
  let probabilityDown = technical.probabilityDown - sentimentAdjustment;
  let probabilityFlat = technical.probabilityFlat;

  const directionalTotal = probabilityUp + probabilityDown + probabilityFlat;
  probabilityUp /= directionalTotal;
  probabilityDown /= directionalTotal;
  probabilityFlat /= directionalTotal;

  if (sentiment.articleCount === 0) {
    notes.push("No recent news available: technical model kept unchanged.");
  } else if (Math.abs(sentimentAdjustment) < 0.01) {
    notes.push(`News sentiment is ${sentiment.label}, but the adjustment is too small to materially change the forecast.`);
  } else {
    notes.push(`News sentiment adjusted directional probability by ${(sentimentAdjustment * 100).toFixed(1)} percentage points.`);
  }

  let earningsPenalty = 0;
  if (earnings.hasUpcomingEarnings && earnings.daysToEarnings != null) {
    // Earnings are event risk, not a directional signal. Reduce confidence only.
    earningsPenalty = earnings.daysToEarnings <= 1 ? 0.25 : earnings.daysToEarnings <= 3 ? 0.18 : 0.12;
    notes.push(`Upcoming earnings in ${earnings.daysToEarnings} day(s): confidence reduced because event volatility can invalidate technical signals.`);
  }

  const confidence = clamp(technical.confidence * (1 - earningsPenalty), 0.05, 0.95);

  return {
    probabilityUp: +probabilityUp.toFixed(4),
    probabilityDown: +probabilityDown.toFixed(4),
    probabilityFlat: +probabilityFlat.toFixed(4),
    confidence: +confidence.toFixed(4),
    sentimentAdjustment: +sentimentAdjustment.toFixed(4),
    earningsPenalty,
    contextNotes: notes,
  };
}
