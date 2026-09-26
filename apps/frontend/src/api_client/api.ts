import { QueryClient } from "@tanstack/react-query";
import { jwtDecode } from "jwt-decode";
import { Cookies } from "react-cookie";
import { notification } from "../service/notifications";

const PUBLIC_URL = import.meta.env.VITE_PUBLIC_URL || import.meta.env.PUBLIC_URL || "";
const API_BASE_URL = PUBLIC_URL + "/api";

/**
 * A failed response, carrying its status so callers can react to it. See issue #492.
 *
 * `serverMessage` is only set when the backend actually sent a human readable
 * error; `message` falls back to an internal English string that must never be
 * shown to a user.
 */
export class ApiError extends Error {
  readonly status: number;

  readonly serverMessage: string | null;

  constructor(message: string, status: number, serverMessage: string | null = null) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.serverMessage = serverMessage;
  }
}

/**
 * How to read a successful response body. "auto" (the default) picks by
 * Content-Type; "blob" and "text" force a type, e.g. for file downloads whose
 * Content-Type depends on the server's mimetype guess.
 */
export type ResponseType = "auto" | "blob" | "text";

export type RequestOptions = RequestInit & { responseType?: ResponseType };

// Custom fetch client with auth and refresh token functionality
class FetchClient {
  /**
   * The refresh currently on the wire. Concurrent requests share it so a burst
   * of requests with an expired token (or a burst of 401s) POSTs one refresh,
   * not one per request. Cleared once it settles. Mirrors the single-flight
   * refresh in packages/api-client/src/transport/client.ts.
   */
  private static refreshInFlight: Promise<string | null> | null = null;

  /**
   * Set once the first failed authentication starts logging the user out, so
   * concurrent 401s don't each blacklist the token, notify and redirect. Never
   * reset: logging out ends in a full page navigation, which reloads this module.
   */
  private static loggingOut = false;

  private static isTokenExpired(exp: number): boolean {
    return 1000 * exp - new Date().getTime() < 5000;
  }

  private static refreshToken(): Promise<string | null> {
    if (!FetchClient.refreshInFlight) {
      FetchClient.refreshInFlight = FetchClient.requestNewAccessToken().finally(() => {
        FetchClient.refreshInFlight = null;
      });
    }
    return FetchClient.refreshInFlight;
  }

  private static async requestNewAccessToken(): Promise<string | null> {
    const cookies = new Cookies();
    const refreshToken = cookies.get("refresh");

    if (!refreshToken) {
      return null;
    }

    try {
      const refreshResponse = await fetch(`${API_BASE_URL}/auth/token/refresh/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refresh: refreshToken }),
        credentials: "include",
      });

      if (refreshResponse.ok) {
        const refreshData = await refreshResponse.json();
        cookies.set("access", refreshData.access);
        return refreshData.access;
      }
    } catch (error) {
      console.error("Token refresh failed", error);
    }
    return null;
  }

  private static async handleAuthError(response: Response, endpoint: string, options: RequestInit): Promise<Response> {
    // A 401 from the token endpoints themselves (e.g. wrong credentials on
    // login) is not an expired access token, so refreshing cannot fix it.
    if (response.status === 401 && !endpoint.includes("/auth/token/")) {
      const newToken = await FetchClient.refreshToken();

      if (newToken) {
        // Retry the original request with new token
        const headers = new Headers(options.headers || {});
        headers.set("Authorization", `Bearer ${newToken}`);
        return fetch(`${API_BASE_URL}${endpoint}`, {
          ...options,
          headers,
          credentials: "include",
        });
      }
    }
    return response;
  }

  /** Pull a human readable message out of the DRF error body, if there is one. */
  private static async extractErrorMessage(response: Response): Promise<string | null> {
    try {
      const data = await response.clone().json();
      if (Array.isArray(data?.errors)) {
        // Only the first one: in DEBUG the backend appends a long auth help
        // paragraph as a second entry, which is not a user facing message.
        const first = data.errors.map((error: { message?: string }) => error.message).find(Boolean);
        if (first) {
          return first;
        }
      }
      if (typeof data?.detail === "string") {
        return data.detail;
      }
    } catch {
      // body was empty or not JSON, fall through to the generic message
    }
    return null;
  }

  private static async handleError(response: Response, endpoint: string) {
    if (response.status === 500) {
      notification.requestFailed(
        `500 (Internal Server Error) for ${endpoint}`,
        "Something went wrong on the server. Please open up the network tab in your browser's developer tools and report this issue on GitHub."
      );
      throw new ApiError("Internal Server Error", 500);
    }

    if (response.status === 401) {
      // Check if we're on a public page or auth pages - don't handle 401 as an error there
      const isPublicPage = window.location.pathname.startsWith("/public");
      // The password-reset request/confirm pages are reached while logged out, so
      // background 401s there must not clear cookies or bounce to login.
      const isPasswordResetPage = window.location.pathname.includes("/password-reset");
      const isLoginPage = window.location.pathname.includes("/login");
      const isSignupPage = window.location.pathname.includes("/signup");
      const suppressAuthNotifications = isPublicPage || isPasswordResetPage || isLoginPage || isSignupPage;

      if (!isPublicPage && !isPasswordResetPage) {
        if (!isLoginPage) {
          // Another request already started logging out and redirecting.
          if (FetchClient.loggingOut) {
            throw new ApiError("Authentication failed", 401);
          }
          FetchClient.loggingOut = true;
        }
        // Logout the user by blacklisting the refresh token
        const cookies = new Cookies();
        const refreshToken = cookies.get("refresh");
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
        if (!isLoginPage) {
          cookies.remove("access");
          cookies.remove("refresh");
          cookies.remove("jwt");
          // A full navigation on purpose: the router lives in App.tsx (importing it
          // here would be circular) and a reload also drops the cached queries.
          window.location.href = PUBLIC_URL + "/login";
        }

        // Always show notifications for login attempts (wrong credentials),
        // but suppress other 401 notifications on public/login/signup pages
        const isLoginAttempt = endpoint === "/auth/token/obtain/";
        if (!suppressAuthNotifications || isLoginAttempt) {
          const data = await response.json();
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
        throw new ApiError("Authentication failed", 401);
      }
      // On public pages, silently ignore 401 errors for authenticated-only endpoints
      // Return a response that will result in undefined/null data
      throw new ApiError("Not authenticated (public page)", 401);
    }
  }

  static async request<T>(endpoint: string, requestOptions: RequestOptions = {}): Promise<T> {
    const { responseType = "auto", ...options } = requestOptions;
    const cookies = new Cookies();
    const accessToken = cookies.get("access");

    // Create headers with auth token if available
    const headers = new Headers(options.headers || {});
    if (accessToken && !endpoint.includes("/auth/token/refresh/")) {
      try {
        const decodedToken = jwtDecode<{ exp: number }>(accessToken);
        if (FetchClient.isTokenExpired(decodedToken.exp)) {
          const newToken = await FetchClient.refreshToken();
          if (newToken) {
            headers.set("Authorization", `Bearer ${newToken}`);
          }
        } else {
          headers.set("Authorization", `Bearer ${accessToken}`);
        }
      } catch (error) {
        console.error("Error decoding token:", error);
      }
    }

    // FormData needs the browser to set a multipart Content-Type with its boundary.
    if (!headers.has("Content-Type") && !(options.body instanceof FormData)) {
      headers.set("Content-Type", "application/json");
    }

    // Create the request config
    const config: RequestInit = {
      ...options,
      headers,
      credentials: "include",
    };

    // Convert body to JSON string if it's an object
    if (config.body && typeof config.body === "object" && !(config.body instanceof FormData)) {
      config.body = JSON.stringify(config.body);
    }

    try {
      let response = await fetch(`${API_BASE_URL}${endpoint}`, config);

      // Handle auth errors and token refresh
      response = await FetchClient.handleAuthError(response, endpoint, config);

      // Handle other errors
      if (!response.ok) {
        await FetchClient.handleError(response, endpoint);
        const message = await FetchClient.extractErrorMessage(response);
        throw new ApiError(message ?? `API error: ${response.status} ${response.statusText}`, response.status, message);
      }

      if (responseType === "blob") {
        return (await response.blob()) as unknown as T;
      }
      if (responseType === "text") {
        return (await response.text()) as unknown as T;
      }

      // Handle different response types
      const contentType = response.headers.get("content-type");
      if (contentType && contentType.includes("application/json")) {
        return (await response.json()) as T;
      }
      if (
        contentType &&
        (contentType.includes("application/octet-stream") ||
          contentType.includes("application/x-zip-compressed") ||
          contentType.includes("application/zip"))
      ) {
        return (await response.blob()) as unknown as T;
      }
      return (await response.text()) as unknown as T;
    } catch (error) {
      // HTTP errors reach the caller as ApiError (and 500/401 already notify);
      // only log what the server never answered, like network failures.
      if (!(error instanceof ApiError)) {
        console.error(`Fetch error for ${endpoint}:`, error);
      }
      throw error;
    }
  }

  request<T>(endpoint: string, options: RequestOptions = {}): Promise<T> {
    return (this.constructor as typeof FetchClient).request<T>(endpoint, options);
  }

  get<T>(endpoint: string): Promise<T> {
    return (this.constructor as typeof FetchClient).request<T>(endpoint, { method: "GET" });
  }

  /** GET a file (e.g. a download) as a Blob, whatever Content-Type the server sends. */
  getBlob(endpoint: string): Promise<Blob> {
    return (this.constructor as typeof FetchClient).request<Blob>(endpoint, { method: "GET", responseType: "blob" });
  }

  post<T>(endpoint: string, data?: any): Promise<T> {
    return (this.constructor as typeof FetchClient).request<T>(endpoint, {
      method: "POST",
      body: data,
    });
  }

  patch<T>(endpoint: string, data: any): Promise<T> {
    return (this.constructor as typeof FetchClient).request<T>(endpoint, {
      method: "PATCH",
      body: data,
    });
  }

  delete<T>(endpoint: string, data?: any): Promise<T> {
    return (this.constructor as typeof FetchClient).request<T>(endpoint, {
      method: "DELETE",
      body: data,
    });
  }
}

const fetchClient = new FetchClient();
export { fetchClient };

// Create QueryClient
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000, // 5 minutes
      retry: 1,
    },
  },
});
