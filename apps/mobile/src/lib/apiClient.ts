import { createApiClient, type ApiClient } from "@librephotos/api-client";
import { useSettingsStore } from "@/stores/settings";
import { useAuthStore } from "@/stores/auth";
import { tokenStorage } from "@/lib/tokenStorage";

/**
 * The single app-wide ApiClient. The base URL is read live from the settings
 * store (self-hosted server URL can change), tokens come from secure-store, and
 * an unrecoverable auth failure flips the auth store to "unauthenticated" so the
 * router bounces to the login screen. Mobile uses the Authorization header only
 * (no cookies), so `useCredentials` stays false.
 */
/**
 * Never return an empty base URL. A relative request in Expo Go resolves
 * against the Metro dev server, which answers unknown paths with its own HTML
 * error page — so a missing server URL surfaced as a flood of "API error: 500"
 * that never reached LibrePhotos. Failing loudly here turns a misleading server
 * error into an accurate client one.
 */
function requireBaseUrl(): string {
  const url = useSettingsStore.getState().serverUrl;
  if (!url) throw new Error("No LibrePhotos server configured — sign in again to set the server URL.");
  return url;
}

export const apiClient: ApiClient = createApiClient({
  baseUrl: requireBaseUrl,
  tokens: tokenStorage,
  useCredentials: false,
  onAuthError: () => {
    useAuthStore.getState().onLoggedOut();
  },
});

/** Current bare server origin (no `/api`), for building media URLs. */
export function serverAddress(): string {
  return useSettingsStore.getState().serverUrl ?? "";
}
