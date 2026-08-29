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
