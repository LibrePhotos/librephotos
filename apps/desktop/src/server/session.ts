/**
 * The signed-in session and the one api-client of the desktop app (CONTRACT.md "Server").
 *
 * - Requests: `createApiClient` from `@librephotos/api-client/core` with the native transport
 *   (`./transport`), so every call is an endpoint function of the shared package, parsed by its
 *   zod schema, and sent by Rust.
 * - Tokens: a `TokenSupplier` in memory, fed from Rust at start (the refresh token lives in the
 *   OS keychain, never in web storage). Rust also gets each new access token, for the media proxy,
 *   and the token is refreshed (`endpoints.refreshAccessToken`) a minute before it expires, so
 *   server thumbnails keep loading while no API request is due.
 * - Sign-in, refresh and sign-out are `endpoints.login`, `refreshAccessToken` and `logout`.
 */
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

/** What `server_session` answers: the saved sign-in. */
type Saved = { url: string | null; username: string | null; userId: number | null; refresh: string | null };

const EXPIRED = "Your sign-in expired. Sign in again.";
/** Refresh this long before the access token expires. */
const REFRESH_AHEAD_MS = 60_000;

let session: Session = { url: null, username: null, userId: null, access: null, refresh: null };
const listeners = new Set<() => void>();
let refreshTimer = 0;

function changed(): void {
  for (const listener of listeners) listener();
}

/** Calls `listener` when the session signs in, out or gets a new token. */
export function onSessionChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The server's address (no `/api`), for media URLs. */
export function serverUrl(): string | null {
  return session.url;
}

/** The signed-in user (server image hashes end in their id), or null. */
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
  // The transport gives up: the refresh token was refused.
  clearTokens: () => forget(EXPIRED),
};

/** The client every server request of the app goes through. */
export const client: ApiClient = createApiClient({
  baseUrl: () => {
    if (!session.url) throw new NotSignedIn();
    return session.url;
  },
  tokens,
  fetch: nativeFetch,
});

/** A new access token now (a network failure leaves the old one; the next request tries again). */
async function refreshNow(): Promise<void> {
  const refresh = session.refresh;
  if (!refresh) return;
  try {
    const { access } = await serverCall(() => endpoints.refreshAccessToken(client, refresh));
    if (session.refresh === refresh) setAccess(access);
  } catch {
    // A refused token signed the client out (clearTokens); anything else retries with the next request.
  }
}

/** A client without tokens: sign-in, and the sign-out after the tokens are gone. */
function anonymousClient(base: string): ApiClient {
  return createApiClient({
    baseUrl: base,
    tokens: { getAccessToken: () => null, getRefreshToken: () => null, setAccessToken: () => {}, clearTokens: () => {} },
    fetch: nativeFetch,
  });
}

let loaded: Promise<void> | null = null;

/** Loads the saved sign-in from Rust once; later calls wait for the same load. */
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

/**
 * Signs in with `endpoints.login`; the refresh token goes to the keychain (Rust). A wrong
 * password rejects with "Wrong username or password".
 */
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

/** Signs out: forgets the tokens and blacklists the refresh token on the server (best effort). */
export async function signOut(): Promise<void> {
  const { refresh, url } = session;
  forget(null);
  if (refresh && url) await serverCall(() => endpoints.logout(anonymousClient(url), refresh)).catch(() => undefined);
}
