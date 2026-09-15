export function normalizeApiBaseUrl(value: string) {
  return value
    .trim()
    .replace(/\/+$/, "")
    .replace(/\/api$/i, "");
}

export function apiUrlFromBase(baseUrl: string, path: string) {
  const base = normalizeApiBaseUrl(baseUrl);
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${base}${normalizedPath}`;
}

export async function apiFetchFromBase<T>(
  baseUrl: string,
  path: string,
  init: RequestInit = {},
  timeoutMs = 12000,
): Promise<T> {
  const normalizedBase = normalizeApiBaseUrl(baseUrl);
  if (!normalizedBase) throw new Error("API URL not configured");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(apiUrlFromBase(normalizedBase, path), {
      ...init,
      headers: { Accept: "application/json", ...(init.headers ?? {}) },
      signal: controller.signal,
    });

    const raw = await response.text();
    let body: unknown = null;
    try {
      body = raw ? JSON.parse(raw) : null;
    } catch {
      body = null;
    }

    if (!response.ok) {
      const message =
        typeof body === "object" && body !== null && "error" in body
          ? String((body as { error?: unknown }).error ?? "")
          : "";
      throw new Error(message || `API ${response.status}`);
    }

    return body as T;
  } catch (error: unknown) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("Request timed out");
    }
    throw error instanceof Error ? error : new Error("Network request failed");
  } finally {
    clearTimeout(timeout);
  }
}
