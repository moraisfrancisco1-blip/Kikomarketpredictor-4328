import { afterEach, describe, expect, test } from "bun:test";
import { apiUrl, apiFetch } from "./api";

describe("mobile API client", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test("normalizes API paths without duplicate slashes", () => {
    expect(apiUrl("api/health")).toContain("/api/health");
    expect(apiUrl("/api/health")).toContain("/api/health");
  });

  test("parses successful JSON responses", async () => {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ status: "ok" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })) as typeof fetch;

    await expect(apiFetch<{ status: string }>("/api/health")).resolves.toEqual({ status: "ok" });
  });

  test("surfaces API error messages", async () => {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ error: "backend unavailable" }), {
        status: 503,
        headers: { "content-type": "application/json" },
      })) as typeof fetch;

    await expect(apiFetch("/api/health")).rejects.toThrow("backend unavailable");
  });

  test("fails fast when a request times out", async () => {
    globalThis.fetch = ((_: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_, reject) => {
        init?.signal?.addEventListener("abort", () => {
          const error = new Error("aborted");
          error.name = "AbortError";
          reject(error);
        });
      })) as typeof fetch;

    await expect(apiFetch("/api/health", {}, 10)).rejects.toThrow("Request timed out");
  });
});
