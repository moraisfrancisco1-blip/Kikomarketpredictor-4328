import { afterEach, describe, expect, test } from "bun:test";
import { apiFetchFromBase, apiUrlFromBase, normalizeApiBaseUrl } from "./api-core";

describe("mobile API core", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test("normalizes host and /api base URLs", () => {
    expect(normalizeApiBaseUrl(" https://example.com/// ")).toBe("https://example.com");
    expect(normalizeApiBaseUrl("https://example.com/api/")).toBe("https://example.com");
    expect(normalizeApiBaseUrl("https://example.com/API")).toBe("https://example.com");
  });

  test("builds API paths without duplicate slashes", () => {
    expect(apiUrlFromBase("https://example.com///", "api/health")).toBe(
      "https://example.com/api/health",
    );
    expect(apiUrlFromBase("https://example.com/api", "/api/health")).toBe(
      "https://example.com/api/health",
    );
  });

  test("parses successful JSON responses", async () => {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ status: "ok" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })) as unknown as typeof fetch;

    await expect(
      apiFetchFromBase<{ status: string }>("https://example.com", "/api/health"),
    ).resolves.toEqual({ status: "ok" });
  });

  test("surfaces API error messages", async () => {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ error: "backend unavailable" }), {
        status: 503,
        headers: { "content-type": "application/json" },
      })) as unknown as typeof fetch;

    await expect(
      apiFetchFromBase("https://example.com", "/api/health"),
    ).rejects.toThrow("backend unavailable");
  });

  test("falls back to HTTP status when API error body is not JSON", async () => {
    globalThis.fetch = (async () => new Response("service unavailable", { status: 503 })) as unknown as typeof fetch;

    await expect(
      apiFetchFromBase("https://example.com", "/api/health"),
    ).rejects.toThrow("API 503");
  });

  test("fails fast when a request times out", async () => {
    globalThis.fetch = ((_: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_, reject) => {
        init?.signal?.addEventListener("abort", () => {
          const error = new Error("aborted");
          error.name = "AbortError";
          reject(error);
        });
      })) as unknown as typeof fetch;

    await expect(
      apiFetchFromBase("https://example.com", "/api/health", {}, 10),
    ).rejects.toThrow("Request timed out");
  });
});
