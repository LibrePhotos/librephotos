import {
  ApiError,
  createApiClient,
  decodeJwtExp,
  endpoints,
  userIdFromAccessToken,
  type ApiClient,
  type TokenSupplier,
} from "@librephotos/api-client/core";
import { invoke } from "@tauri-apps/api/core";
import { inTauri } from "../ipc";
import { NotSignedIn, serverCall } from "./errors";
import { nativeFetch } from "./transport";

type Session = {
  url: string | null;
  username: string | null;
  userId: number | null;
  access: string | null;
  refresh: string | null;
};

type Saved = { url: string | null; username: string | null; userId: number | null; refresh: string | null };

const EXPIRED = "Your sign-in expired. Sign in again.";
const REFRESH_AHEAD_MS = 60_000;

let session: Session = { url: null, username: null, userId: null, access: null, refresh: null };
const listeners = new Set<() => void>();
let refreshTimer = 0;

function changed(): void {
  for (const listener of listeners) listener();
}

export function onSessionChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function serverUrl(): string | null {
  return session.url;
}

export function signedInUser(): number | null {
  return session.refresh ? session.userId : null;
}

export function isSignedIn(): boolean {
  return session.refresh !== null && session.userId !== null && session.url !== null;
}

function setAccess(token: string | null): void {
  session.access = token;
  if (inTauri) void invoke("server_set_access", { token }).catch(() => undefined);
  window.clearTimeout(refreshTimer);
  const exp = token ? decodeJwtExp(token) : null;
  if (exp !== null) {
    refreshTimer = window.setTimeout(() => void refreshNow(), Math.max(5_000, exp * 1000 - Date.now() - REFRESH_AHEAD_MS));
  }
  changed();
}

function forget(reason: string | null): void {
  const had = session.refresh !== null;
  session = { ...session, userId: null, access: null, refresh: null };
  window.clearTimeout(refreshTimer);
  if (inTauri && had) void invoke("server_signed_out", { reason }).catch(() => undefined);
  changed();
}

const tokens: TokenSupplier = {
  getAccessToken: () => session.access,
  getRefreshToken: () => session.refresh,
  setAccessToken: token => setAccess(token),
  clearTokens: () => forget(EXPIRED),
};

export const client: ApiClient = createApiClient({
  baseUrl: () => {
    if (!session.url) throw new NotSignedIn();
    return session.url;
  },
  tokens,
  fetch: nativeFetch,
});

async function refreshNow(): Promise<void> {
  const refresh = session.refresh;
  if (!refresh) return;
  const refreshed = await serverCall(() => endpoints.refreshAccessToken(client, refresh)).catch(() => null);
  if (refreshed && session.refresh === refresh) setAccess(refreshed.access);
}

function anonymousClient(base: string): ApiClient {
  return createApiClient({
    baseUrl: base,
    tokens: { getAccessToken: () => null, getRefreshToken: () => null, setAccessToken: () => {}, clearTokens: () => {} },
    fetch: nativeFetch,
  });
}

let loaded: Promise<void> | null = null;

export function loadSession(): Promise<void> {
  loaded ??= (async () => {
    if (!inTauri) return;
    const saved = await invoke<Saved>("server_session");
    session = { ...saved, access: null };
    changed();
    if (saved.refresh) await refreshNow();
  })();
  return loaded;
}

export async function signIn(url: string, username: string, password: string): Promise<void> {
  if (!inTauri) throw new Error("only in the desktop app");
  await loadSession();
  const base = await invoke<string>("server_prepare_sign_in", { url });
  let pair;
  try {
    pair = await serverCall(() => endpoints.login(anonymousClient(base), { username, password }));
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) throw new Error("Wrong username or password");
    if (err instanceof ApiError && err.status === 404) throw new Error(`${base} doesn't look like a LibrePhotos server`);
    throw err;
  }
  const userId = userIdFromAccessToken(pair.access);
  if (userId === null) throw new Error("the server's sign-in token has no user id");
  await invoke("server_signed_in", { signIn: { url: base, username, userId, refresh: pair.refresh, access: pair.access } });
  session = { url: base, username, userId, access: null, refresh: pair.refresh };
  setAccess(pair.access);
}

export async function signOut(): Promise<void> {
  const { refresh, url } = session;
  forget(null);
  if (refresh && url) await serverCall(() => endpoints.logout(anonymousClient(url), refresh)).catch(() => undefined);
}
