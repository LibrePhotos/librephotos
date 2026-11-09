import {
  createApiClient,
  ApiError as SharedApiError,
  type ApiClient,
  type RequestOptions as SharedRequestOptions,
  type TokenSupplier,
} from "@librephotos/api-client";
import { MutationCache, QueryCache, QueryClient } from "@tanstack/react-query";
import { notification } from "../service/notifications";
import { ApiError } from "./apiError";
import { clearAuthCookies, getAuthCookie, setAuthCookie } from "./authCookies";
import { reportMutationError, reportWriteError } from "./mutationErrors";
import { notifyParseError } from "./parseErrors";
import { reportRequestFailure } from "./server/backendTrouble";
import { dropStaleSession, expireSession } from "./session";

const PUBLIC_URL = import.meta.env.VITE_PUBLIC_URL || import.meta.env.PUBLIC_URL || "";

// The error every request rejects with (its own module, so media/mediaUrl can throw it without this one).
export { ApiError } from "./apiError";

export type RequestOptions = SharedRequestOptions;

/** The web keeps its JWTs in (script-readable) cookies. */
const cookieTokens: TokenSupplier = {
  getAccessToken: () => getAuthCookie("access") ?? null,
  getRefreshToken: () => getAuthCookie("refresh") ?? null,
  setAccessToken: token => setAuthCookie("access", token),
  clearTokens: clearAuthCookies,
};

const isPublicPage = () => window.location.pathname.startsWith("/public");

/** One `{ field, message }` entry of the backend's error body. */
function isFieldError(value: unknown): value is { field: string; message: string } {
  return (
    typeof value === "object" &&
    value !== null &&
    "field" in value &&
    typeof value.field === "string" &&
    "message" in value &&
    typeof value.message === "string"
  );
}

const LOGIN_ENDPOINT = "/auth/token/obtain/";

/** The server's logout: blacklists the refresh token and clears the HttpOnly jwt cookie. */
async function logOutOnServer(refreshToken: string | undefined): Promise<void> {
  try {
    await fetch(`${PUBLIC_URL}/api/auth/token/blacklist/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refresh: refreshToken }),
      credentials: "include",
    });
  } catch (error) {
    console.error("Logout failed:", error);
  }
}

/** Where a 401 happened: a page for everyone, a page for signing in or up, or the signed-in app. */
type UnauthorizedPage = "public" | "signedOut" | "app";

function unauthorizedPage(pathname: string): UnauthorizedPage {
  // Public pages and the password-reset pages are reached while logged out.
  if (isPublicPage() || pathname.includes("/password-reset")) return "public";
  if (pathname.includes("/login") || pathname.includes("/signup")) return "signedOut";
  return "app";
}

/** Wrong credentials: the server's reason for refusing the sign-in. */
async function reportRefusedLogin(response: Response): Promise<void> {
  const data: unknown = await response.json().catch(() => ({}));
  const body = typeof data === "object" && data !== null ? data : {};
  const errors = "errors" in body ? body.errors : undefined;
  const detail = "detail" in body ? body.detail : undefined;
  if (errors) {
    // The backend's exception handler: { errors: [{ field, message }] }
    const entries: unknown[] = Array.isArray(errors) ? errors : [];
    entries.forEach(error => {
      if (isFieldError(error) && error.field === "detail") {
        notification.authError(true, error.field, error.message);
      }
    });
  } else if (typeof detail === "string" && detail) {
    notification.authError(true, "detail", detail);
  }
}

/**
 * A 401 the shared transport could not fix with a token refresh. The web decides itself what it
 * means: nothing on public pages; on the login and sign-up pages a refused sign-in (or a sign-up
 * refused because registration is off, which the form reports itself); in the app, the end of the
 * session (`expireSession`).
 */
async function handleUnauthorized(endpoint: string, response: Response): Promise<void> {
  const page = unauthorizedPage(window.location.pathname);
  switch (page) {
    case "public":
      return;
    case "app":
      return expireSession(logOutOnServer);
    case "signedOut":
      await dropStaleSession(logOutOnServer);
      if (endpoint === LOGIN_ENDPOINT) await reportRefusedLogin(response);
      return;
  }
}

/**
 * The shared transport (packages/api-client): bearer token from the cookies,
 * proactive + single-flight refresh, a 401 retry, and cookies sent along
 * (`credentials: "include"`) for the media endpoints.
 */
const sharedClient = createApiClient({
  baseUrl: PUBLIC_URL,
  tokens: cookieTokens,
  useCredentials: true,
  onUnauthorized: handleUnauthorized,
  onServerError: endpoint => notification.serverError(endpoint),
});

/**
 * The same transport for the browser error forwarder (#2938): a failure there is dropped, so it
 * never toasts, signs the user out or reports the backend down. Only api_client/errorReports uses it.
 */
export const quietApiClient: ApiClient = createApiClient({
  baseUrl: PUBLIC_URL,
  tokens: cookieTokens,
  useCredentials: true,
  onUnauthorized: () => undefined,
});

/**
 * Rethrow a failure as the web's ApiError. A 500 and a 401 already notified
 * above, so they carry no server message: callers fall back to a generic,
 * translated one (see util/apiErrors.ts).
 */
function toWebError(error: unknown, endpoint: string): unknown {
  if (error instanceof ApiError) {
    return error;
  }
  if (error instanceof SharedApiError) {
    const { status, body } = error;
    if (status === 500) {
      return new ApiError("Internal Server Error", 500, null, endpoint, body);
    }
    if (status === 401) {
      const message = isPublicPage() ? "Not authenticated (public page)" : "Authentication failed";
      return new ApiError(message, 401, null, endpoint, body);
    }
    return new ApiError(error.serverMessage ?? error.message, status, error.serverMessage, endpoint, body);
  }
  // HTTP errors reach the caller as ApiError; only log what the server never
  // answered, like network failures.
  console.error(`Fetch error for ${endpoint}:`, error);
  return error;
}

async function call<T>(endpoint: string, run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    const webError = toWebError(error, endpoint);
    // A server that is down or starting gets BackendStatusGate's screen (#2310).
    reportRequestFailure(webError);
    throw webError;
  }
}

/**
 * The app-wide ApiClient: pass it to the shared endpoints
 * (`endpoints.fetchThingAlbumsList(apiClient)`); <ApiClientProvider> hands it
 * to the shared hooks.
 */
export const apiClient: ApiClient = {
  request: <T>(endpoint: string, options?: RequestOptions) =>
    call(endpoint, () => sharedClient.request<T>(endpoint, options)),
  get: <T>(endpoint: string) => call(endpoint, () => sharedClient.get<T>(endpoint)),
  getBlob: (endpoint: string) => call(endpoint, () => sharedClient.getBlob(endpoint)),
  post: <T>(endpoint: string, data?: unknown) => call(endpoint, () => sharedClient.post<T>(endpoint, data)),
  patch: <T>(endpoint: string, data?: unknown) => call(endpoint, () => sharedClient.patch<T>(endpoint, data)),
  delete: <T>(endpoint: string, data?: unknown) => call(endpoint, () => sharedClient.delete<T>(endpoint, data)),
  resolveBaseUrl: () => sharedClient.resolveBaseUrl(),
};

// Create QueryClient
export const queryClient = new QueryClient({
  queryCache: new QueryCache({ onError: notifyParseError }),
  mutationCache: new MutationCache({
    onError: (error, _variables, _onMutateResult, mutation) => {
      notifyParseError(error);
      reportMutationError(error, mutation);
    },
    onSuccess: data => {
      reportWriteError(data);
    },
  }),
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000, // 5 minutes
      retry: 1,
    },
  },
});
