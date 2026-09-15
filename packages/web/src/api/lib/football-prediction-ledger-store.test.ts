import { describe, expect, test } from "bun:test";
import { recordFootballPrediction, resolveFootballPrediction } from "./football-prediction-ledger";
import { clearFootballPredictionStore, getFootballPrediction, listFootballPredictions, saveFootballPrediction } from "./football-prediction-ledger-store";

const row = (id: string) => recordFootballPrediction({
  predictionId: id,
  fixtureDate: "2026-09-20",
  recordedAt: "2026-09-19T12:00:00.000Z",
  home: "Alpha",
  away: "Beta",
  probHome: 0.5,
  probDraw: 0.3,
  probAway: 0.2,
});

describe("football prediction ledger store", () => {
  test("saves, retrieves, replaces and lists predictions", () => {
    clearFootballPredictionStore();
    const first = saveFootballPrediction(row("a"));
    expect(getFootballPrediction("a")).toEqual(first);
    saveFootballPrediction(resolveFootballPrediction(first, 0));
    expect(getFootballPrediction("a")?.outcome).toBe(0);
    saveFootballPrediction(row("b"));
    expect(listFootballPredictions().map((x) => x.predictionId)).toEqual(["a", "b"]);
    clearFootballPredictionStore();
    expect(listFootballPredictions()).toEqual([]);
  });
});
