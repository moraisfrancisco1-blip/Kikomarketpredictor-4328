import type { Prediction } from "./market";
import { fetchSentiment, fetchEarningsInfo } from "./market";

/**
 * Context enrichment is deliberately bounded: technical signals remain the
 * primary source of direction, while news and earnings mainly refine risk.
 */
export async function getPredictionContext(symbol: string) {
  const [sentimentResult, earningsResult] = await Promise.allSettled([
    fetchSentiment(symbol),
    fetchEarningsInfo(symbol),
  ]);

  const sentiment = sentimentResult.status === "fulfilled" ? sentimentResult.value : null;
  const earnings = earningsResult.status === "fulfilled" ? earningsResult.value : null;

  return {
    sentiment,
    earnings,
    enrichmentWarnings: [
      ...(sentimentResult.status === "rejected" ? ["sentiment unavailable"] : []),
      ...(earningsResult.status === "rejected" ? ["earnings unavailable"] : []),
    ],
  };
}

/**
 * Apply external context after the technical model has produced its base
 * prediction. Sentiment is capped at +/-8 percentage points; earnings only
 * reduce confidence and never force a bearish direction.
 */
export function applyPredictionContext(
  prediction: Prediction,
  context: Awaited<ReturnType<typeof getPredictionContext>>,
): Prediction {
  const sentiment = context.sentiment;
  const earnings = context.earnings;

  // One headline can never move the model by more than 1.5pp. Influence
  // increases with breadth but is capped at 8pp to keep technicals dominant.
  const articleCount = sentiment?.articleCount ?? 0;
  const sentimentCap = Math.min(0.08, articleCount * 0.015);
  const sentimentAdjustment = sentiment
    ? Math.max(-sentimentCap, Math.min(sentimentCap, sentiment.score * sentimentCap))
    : 0;

  const adjustedDirectional = Math.max(
    0.05,
    Math.min(0.95, prediction.probabilityUpCalibrated + sentimentAdjustment),
  );

  const technicalDistance = Math.abs(prediction.probabilityUpCalibrated - 0.5) * 2;
  const adjustedDistance = Math.abs(adjustedDirectional - 0.5) * 2;
  const probabilityFlat = prediction.probabilityFlat ?? 0.34;
  const directionalMass = 1 - probabilityFlat;
  const probabilityUp = Math.max(
    0.01,
    Math.min(0.99, adjustedDirectional * directionalMass + probabilityFlat * 0.5),
  );
  const probabilityDown = Math.max(0.01, Math.min(0.99, directionalMass - adjustedDirectional * directionalMass + probabilityFlat * 0.5));

  const direction: Prediction["direction"] =
    adjustedDirectional >= 0.58 ? "up" : adjustedDirectional <= 0.42 ? "down" : "flat";

  let confidence = prediction.confidence;
  const earningsWarning = earnings?.warning ?? null;
  let earningsImpact = "−nenhuma";
  if (earnings?.hasUpcomingEarnings) {
    const days = earnings.daysToEarnings;
    const penalty = days != null && days <= 2 ? 0.35 : 0.20;
    confidence *= 1 - penalty;
    earningsImpact = `−${Math.round(penalty * 100)}%`;
  }
  confidence = Math.max(0.03, Math.min(0.82, confidence));

  const confPct = Math.round(confidence * 100);
  const confLabel = confPct >= 70 ? "Alta" : confPct >= 55 ? "Moderada" : confPct >= 35 ? "Baixa" : "Muito baixa";

  const breakdown = [
    ...prediction.confidenceExplained.breakdown,
    {
      factor: "Sentimento / notícias",
      impact: sentiment
        ? sentimentAdjustment > 0 ? "+ajuste bullish" : sentimentAdjustment < 0 ? "−ajuste bearish" : "−neutro"
        : "−indisponível",
      note: sentiment
        ? `${sentiment.articleCount} artigo(s), score ${(sentiment.score * 100).toFixed(0)}%. Ajuste limitado a ${(sentimentCap * 100).toFixed(1)}pp.`
        : "Sem dados de sentimento; a previsão técnica mantém-se intacta.",
    },
    {
      factor: "Resultados",
      impact: earningsImpact,
      note: earnings?.hasUpcomingEarnings
        ? `Resultados em ${earnings.daysToEarnings} dia(s): confiança reduzida, mas a direção técnica não é forçada para bearish.`
        : "Sem resultados iminentes que justifiquem penalização adicional.",
    },
  ];

  return {
    ...prediction,
    direction,
    probabilityUp,
    probabilityUpCalibrated: +adjustedDirectional.toFixed(4),
    probabilityDown: +probabilityDown.toFixed(4),
    probabilityFlat,
    confidence,
    earningsWarning,
    confidenceExplained: {
      label: confLabel,
      pct: confPct,
      breakdown,
    },
    // Keep this metadata available to the client without changing the
    // technical expected-return estimate.
    signals: sentiment
      ? [
          ...prediction.signals,
          {
            name: "Sentiment / notícias",
            value: sentiment.label,
            vote: sentiment.score > 0.15 ? 1 : sentiment.score < -0.15 ? -1 : 0,
          },
        ]
      : prediction.signals,
  };
}
