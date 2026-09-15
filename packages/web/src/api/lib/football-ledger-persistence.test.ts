import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { recordFootballPrediction, resolveFootballPrediction } from "./football-prediction-ledger";
import { clearFootballPredictionStore, getFootballPrediction, listFootballPredictions, saveFootballPrediction } from "./football-prediction-ledger-store";

const row = recordFootballPrediction({
  predictionId: "e2e-1",
  fixtureDate: "2026-09-20",
  recordedAt: "2026-09-19T12:00:00.000Z",
  home: "Alpha",
  away: "Beta",
  probHome: 0.5,
  probDraw: 0.3,
  probAway: 0.2,
});

describe("football ledger persistence contract", () => {
  test("keeps the fallback store usable without database configuration", async () => {
    clearFootballPredictionStore();
    const app = new Hono();
    app.post("/track", async (c) => {
      const prediction = recordFootballPrediction(await c.req.json());
      saveFootballPrediction(prediction);
      return c.json({ prediction }, 201);
    });
    app.post("/resolve/:id", async (c) => {
      const existing = getFootballPrediction(c.req.param("id"));
      if (!existing) return c.json({ error: "prediction not found" }, 404);
      const resolved = resolveFootballPrediction(existing, 0);
      saveFootballPrediction(resolved);
      return c.json({ prediction: resolved });
    });

    const tracked = await app.request("/track", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(row),
    });
    expect(tracked.status).toBe(201);
    expect((await tracked.json()).prediction.predictionId).toBe("e2e-1");

    const resolved = await app.request("/resolve/e2e-1", { method: "POST" });
    expect(resolved.status).toBe(200);
    expect((await resolved.json()).prediction.outcome).toBe(0);
    expect(listFootballPredictions()).toHaveLength(1);
    expect(listFootballPredictions()[0]?.outcome).toBe(0);
  });
});
