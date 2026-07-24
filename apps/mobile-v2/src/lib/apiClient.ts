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
export const apiClient: ApiClient = createApiClient({
  baseUrl: () => useSettingsStore.getState().serverUrl ?? "",
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
