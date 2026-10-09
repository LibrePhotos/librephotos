import {
  createApiClient,
  ResponseParseError,
  ApiError as SharedApiError,
  type ApiClient,
  type RequestOptions as SharedRequestOptions,
  type TokenSupplier,
} from "@librephotos/api-client";
import { MutationCache, QueryCache, QueryClient } from "@tanstack/react-query";
import { Cookies } from "react-cookie";
import { notification } from "../service/notifications";
import { clearAuthCookies, setAuthCookie } from "./authCookies";

const PUBLIC_URL = import.meta.env.VITE_PUBLIC_URL || import.meta.env.PUBLIC_URL || "";
const API_BASE_URL = PUBLIC_URL + "/api";

/**
 * A failed response, carrying its status so callers can react to it. See issue #492.
 *
 * `serverMessage` is only set when the backend actually sent a human readable
 * error; `message` falls back to an internal English string that must never be
 * shown to a user.
 *
 * Every request made through `fetchClient`/`apiClient` rejects with this class
 * (a subclass of the shared client's ApiError, so `instanceof` against either
 * works); this constructor keeps the web's argument order.
 */
export class ApiError extends SharedApiError {
  constructor(message: string, status: number, serverMessage: string | null = null, endpoint = "", body?: unknown) {
    super(status, endpoint, message, body, serverMessage);
  }
}

export type { ResponseType } from "@librephotos/api-client";

export type RequestOptions = SharedRequestOptions;

/** The web keeps its JWTs in (script-readable) cookies. */
const cookieTokens: TokenSupplier = {
  getAccessToken: () => new Cookies().get("access") ?? null,
  getRefreshToken: () => new Cookies().get("refresh") ?? null,
  setAccessToken: token => setAuthCookie("access", token),
  clearTokens: clearAuthCookies,
};

/**
 * Set once the first failed authentication (or Log out) starts logging the user
 * out, so concurrent 401s don't each blacklist the token, notify and redirect. Never
 * reset: logging out ends in a full page navigation, which reloads this module.
 */
let loggingOut = false;

const isPublicPage = () => window.location.pathname.startsWith("/public");

/**
 * End the session with a full page load of the login page. Not a router
 * navigation: the cached "logged in" answer would send /login straight back
 * into the app, and a reload drops every cached query, so whoever signs in
 * next in this tab never sees the previous user's data. The 401s that requests
 * still in flight get meanwhile are ignored (see `loggingOut`).
 */
export function redirectToLogin(): void {
  loggingOut = true;
  window.location.assign(PUBLIC_URL + "/login");
}

/**
 * A 401 the shared transport could not fix with a token refresh. The web
 * decides itself whether that logs the user out: not on public pages, and not
 * on the password-reset pages, which are reached while logged out.
 */
async function handleUnauthorized(endpoint: string, response: Response): Promise<void> {
  const { pathname } = window.location;
  const isPasswordResetPage = pathname.includes("/password-reset");
  const isLoginPage = pathname.includes("/login");
  const isSignupPage = pathname.includes("/signup");
  const suppressAuthNotifications = isPublicPage() || isPasswordResetPage || isLoginPage || isSignupPage;
  // Pages for logged-out users stay where they are. A refused sign-up
  // (registration turned off) answers 401 too, and used to reload the sign-up
  // form into the login page without a word; the form reports it itself now.
  const staysOnPage = isLoginPage || isSignupPage;

  // On public pages, silently ignore 401 errors for authenticated-only endpoints.
  if (isPublicPage() || isPasswordResetPage) {
    return;
  }
  if (!staysOnPage) {
    // Another request already started logging out and redirecting.
    if (loggingOut) {
      return;
    }
    loggingOut = true;
  }
  // Logout the user by blacklisting the refresh token
  const refreshToken = new Cookies().get("refresh");
  if (refreshToken) {
    try {
      await fetch(`${API_BASE_URL}/auth/token/blacklist/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refresh: refreshToken }),
        credentials: "include",
      });
    } catch (error) {
      console.error("Logout failed:", error);
    }
  }
  // Clear auth cookies and redirect to login if we are not already on the login page
  if (!staysOnPage) {
    cookieTokens.clearTokens();
    // A full navigation on purpose: the router lives in App.tsx (importing it
    // here would be circular) and a reload also drops the cached queries.
    window.location.href = PUBLIC_URL + "/login";
  }

  // Always show notifications for login attempts (wrong credentials),
  // but suppress other 401 notifications on public/login/signup pages
  const isLoginAttempt = endpoint === "/auth/token/obtain/";
  if (!suppressAuthNotifications || isLoginAttempt) {
    const data = await response.json().catch(() => ({}));
    if (data.errors) {
      data.errors.forEach((error: { field: string; message: string }) => {
        if (error.field === "detail") {
          notification.authError(isLoginAttempt, error.field, error.message);
        }
      });
    } else if (isLoginAttempt && data.detail) {
      notification.authError(true, "detail", data.detail);
    } else if (!isLoginAttempt) {
      notification.invalidToken();
    }
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
    throw toWebError(error, endpoint);
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

/** The name the existing hooks use; same object as `apiClient`. */
export const fetchClient = apiClient;

/** A response that did not match its schema (server drift) asks the user to report it. */
function notifyParseError(error: unknown) {
  if (error instanceof ResponseParseError) {
    notification.parseError(`${error.context}: ${error.issues}`);
  }
}

// Create QueryClient
export const queryClient = new QueryClient({
  queryCache: new QueryCache({ onError: notifyParseError }),
  mutationCache: new MutationCache({ onError: notifyParseError }),
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000, // 5 minutes
      retry: 1,
    },
  },
});
