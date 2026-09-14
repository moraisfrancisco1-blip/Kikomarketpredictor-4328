import Constants from "expo-constants";

const configuredUrl =
  Constants.expoConfig?.extra?.apiUrl ?? process.env.EXPO_PUBLIC_API_URL ?? "";

export const API_BASE_URL = configuredUrl.replace(/\/+$/, "");

export function apiUrl(path: string) {
  const normalized = path.startsWith("/") ? path : `/${path}`;
  return `${API_BASE_URL}${normalized}`;
}

export async function apiFetch<T>(path: string, init: RequestInit = {}, timeoutMs = 12000): Promise<T> {
  if (!API_BASE_URL) throw new Error("API URL not configured");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(apiUrl(path), {
      ...init,
      headers: { Accept: "application/json", ...(init.headers ?? {}) },
      signal: controller.signal,
    });

    const raw = await response.text();
    let body: any = null;
    try { body = raw ? JSON.parse(raw) : null; } catch { body = null; }

    if (!response.ok) {
      throw new Error(body?.error || `API ${response.status}`);
    }
    return body as T;
  } catch (error: any) {
    if (error?.name === "AbortError") throw new Error("Request timed out");
    throw error instanceof Error ? error : new Error("Network request failed");
  } finally {
    clearTimeout(timeout);
  }
}

export async function checkApi() {
  return apiFetch<{ status: string }>("/api/health", {}, 6000);
}
