import { beforeEach, describe, expect, test } from "bun:test";
import app from "./index";
import { clearFootballPredictionStore } from "./lib/football-prediction-ledger-store";

describe("football prediction ledger routes", () => {
  beforeEach(() => clearFootballPredictionStore());

  test("tracks, resolves, reads and reports a prediction through the real app", async () => {
    const predictionId = `route-test-${Date.now()}`;
    const track = await app.request("/api/sports/football/predictions/track", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        predictionId,
        fixtureDate: "2099-06-15T18:00:00.000Z",
        recordedAt: "2099-06-14T12:00:00.000Z",
        home: "Alpha",
        away: "Beta",
        probHome: 0.5,
        probDraw: 0.25,
        probAway: 0.25,
      }),
    });
    expect(track.status).toBe(201);

    const resolve = await app.request(`/api/sports/football/predictions/${predictionId}/resolve`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ outcome: 0 }),
    });
    expect(resolve.status).toBe(200);

    const read = await app.request(`/api/sports/football/predictions/${predictionId}`);
    expect(read.status).toBe(200);
    const readBody = await read.json();
    expect(readBody.prediction.predictionId).toBe(predictionId);
    expect(readBody.prediction.outcome).toBe(0);

    const report = await app.request("/api/sports/football/predictions/report?minimumResolved=1");
    expect(report.status).toBe(200);
    const reportBody = await report.json();
    expect(reportBody.total).toBe(1);
    expect(reportBody.resolved).toBe(1);
    expect(reportBody.unresolved).toBe(0);
    expect(reportBody.calibration).toBe("measured");
    expect(Number.isFinite(reportBody.brier)).toBe(true);
    expect(Number.isFinite(reportBody.logLoss)).toBe(true);
  });

  test("rejects a prediction recorded after its fixture date", async () => {
    const response = await app.request("/api/sports/football/predictions/track", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        predictionId: "route-post-fixture",
        fixtureDate: "2026-06-15T18:00:00.000Z",
        recordedAt: "2026-06-16T12:00:00.000Z",
        home: "Alpha",
        away: "Beta",
        probHome: 0.5,
        probDraw: 0.25,
        probAway: 0.25,
      }),
    });
    expect(response.status).toBe(400);
    expect((await response.json()).error).toContain("recorded after fixture date");
  });
});
