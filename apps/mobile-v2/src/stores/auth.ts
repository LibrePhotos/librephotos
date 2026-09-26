import { create } from "zustand";
import { decodeJwtExp } from "@librephotos/api-client";
import { tokenStorage } from "@/lib/tokenStorage";
import { useSettingsStore } from "@/stores/settings";

export type AuthStatus = "unknown" | "authenticated" | "unauthenticated";

/**
 * Auth session state. The tokens themselves live in secure-store (see
 * tokenStorage); this store only tracks the derived status + current user id so
 * the router can gate screens synchronously. `bootstrap()` runs once at startup
 * to hydrate status from secure-store.
 */
type AuthState = {
  status: AuthStatus;
  userId: number | null;
  bootstrap: () => Promise<void>;
  onLoggedIn: (access: string, refresh: string) => Promise<void>;
  onLoggedOut: () => void;
};

export function userIdFromToken(access: string | null): number | null {
  if (!access) return null;
  // exp is validated by decodeJwtExp; user_id is read opportunistically.
  const parts = access.split(".");
  if (parts.length < 2 || !parts[1]) return null;
  if (typeof atob !== "function") return null;
  try {
    const json = atob(parts[1].replace(/-/g, "+").replace(/_/g, "/"));
    const payload = JSON.parse(json) as { user_id?: number | string };
    const raw = payload.user_id;
    return typeof raw === "number" ? raw : raw ? Number(raw) : null;
  } catch {
    return null;
  }
}

export const useAuthStore = create<AuthState>(set => ({
  status: "unknown",
  userId: null,
  async bootstrap() {
    // Restore the server URL BEFORE reporting "authenticated". Sync starts as
    // soon as the router sees that status, and a run with no base URL issues
    // relative requests that hit the Metro dev server instead of LibrePhotos.
    const serverUrl = await useSettingsStore.getState().hydrateServerUrl();
    const access = await tokenStorage.getAccessToken();
    const refresh = await tokenStorage.getRefreshToken();
    // A refresh token is enough to be "authenticated" — the transport will mint
    // a fresh access token on the first request if the current one is expired.
    // Tokens without a server to spend them on are useless, so treat a missing
    // URL as signed out and send the user back to the login screen.
    if (refresh && serverUrl) {
      set({ status: "authenticated", userId: userIdFromToken(access) });
    } else {
      set({ status: "unauthenticated", userId: null });
    }
  },
  async onLoggedIn(access, refresh) {
    await tokenStorage.setTokens(access, refresh);
    // Touch decodeJwtExp so an unparseable token surfaces immediately in dev.
    decodeJwtExp(access);
    set({ status: "authenticated", userId: userIdFromToken(access) });
  },
  onLoggedOut() {
    set({ status: "unauthenticated", userId: null });
  },
}));
