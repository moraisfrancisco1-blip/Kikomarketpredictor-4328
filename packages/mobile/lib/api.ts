import Constants from "expo-constants";
import { apiFetchFromBase, apiUrlFromBase, normalizeApiBaseUrl } from "./api-core";

// Expo Go can override the preview URL with EXPO_PUBLIC_API_URL.
const configuredUrl =
  process.env.EXPO_PUBLIC_API_URL ?? Constants.expoConfig?.extra?.apiUrl ?? "";

export const API_BASE_URL = normalizeApiBaseUrl(configuredUrl);

export function apiUrl(path: string) {
  return apiUrlFromBase(API_BASE_URL, path);
}

export function apiFetch<T>(
  path: string,
  init: RequestInit = {},
  timeoutMs = 12000,
): Promise<T> {
  return apiFetchFromBase(API_BASE_URL, path, init, timeoutMs);
}

export function checkApi() {
  return apiFetch<{ status: string }>("/api/health", {}, 6000);
}
