import { decodeJwtExp, isExpiryClose } from "./jwt";
import type { ApiClient, ApiClientConfig, RequestOptions, TokenSupplier } from "./types";

/**
 * Thrown for any non-ok HTTP response so callers/hooks can branch on status.
 *
 * `message` is an internal English string. Only `serverMessage` may be shown to
 * a user, and it is only set when the backend actually sent a readable error.
 */
export class ApiError extends Error {
  readonly status: number;
  readonly endpoint: string;
  readonly body: unknown;
  readonly serverMessage: string | null;

  constructor(status: number, endpoint: string, message: string, body?: unknown, serverMessage: string | null = null) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.endpoint = endpoint;
    this.body = body;
    this.serverMessage = serverMessage;
  }
}

/**
 * Pull a human readable message out of a DRF error body: the first
 * `errors[].message` (the backend's custom exception handler; in DEBUG it
 * appends a long auth help paragraph as a later entry, which is not for
 * users), else a string `detail`. Null when there is none.
 */
export function extractServerMessage(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const { errors, detail } = body as { errors?: unknown; detail?: unknown };
  if (Array.isArray(errors)) {
    for (const error of errors) {
      const message = (error as { message?: unknown } | null)?.message;
      if (typeof message === "string" && message) return message;
    }
  }
  return typeof detail === "string" && detail ? detail : null;
}

function isFormData(value: unknown): value is FormData {
  return typeof FormData !== "undefined" && value instanceof FormData;
}

/**
 * Build the injectable, React-free fetch transport with a single-flight refresh
 * interceptor. Adapted from apps/frontend `api_client/api.ts` and the original
 * React Native app's `api_client/api.ts`, unified so both platforms share one
 * implementation:
 *
 *  - a token about to expire is refreshed BEFORE the request (proactive), and
 *  - a 401 triggers ONE reactive refresh + retry (interceptor).
 *
 * Concurrent callers share one in-flight refresh (mutex) so a token stampede
 * doesn't fire N refreshes and blacklist each other.
 */
export function createApiClient(config: ApiClientConfig): ApiClient {
  // Look the global up per call, so a fetch stubbed after the client was built
  // (tests) is still the one that runs.
  const doFetch: typeof fetch = config.fetch ?? ((input, init) => globalThis.fetch(input, init));
  const tokens: TokenSupplier = config.tokens;

  const resolveRoot = (): string => {
    const base = typeof config.baseUrl === "function" ? config.baseUrl() : config.baseUrl;
    return `${base.replace(/\/+$/, "")}/api`;
  };

  let refreshInFlight: Promise<string | null> | null = null;

  const refreshToken = async (): Promise<string | null> => {
    if (refreshInFlight) return refreshInFlight;

    refreshInFlight = (async () => {
      const refresh = await tokens.getRefreshToken();
      if (!refresh) return null;
      try {
        const res = await doFetch(`${resolveRoot()}/auth/token/refresh/`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ refresh }),
          ...(config.useCredentials ? { credentials: "include" } : {}),
        });
        if (res.ok) {
          const data = (await res.json()) as { access: string };
          await tokens.setAccessToken(data.access);
          return data.access;
        }
      } catch {
        // Network / parse failure — treated as "no new token".
      }
      return null;
    })();

    try {
      return await refreshInFlight;
    } finally {
      refreshInFlight = null;
    }
  };

  const authHeader = async (endpoint: string): Promise<string | null> => {
    // Never attach (or refresh) a token on the refresh endpoint itself.
    if (endpoint.includes("/auth/token/refresh/")) return null;
    const access = await tokens.getAccessToken();
    if (!access) return null;
    const exp = decodeJwtExp(access);
    if (exp !== null && isExpiryClose(exp)) {
      const refreshed = await refreshToken();
      return refreshed ?? access;
    }
    return access;
  };

  const request = async <T>(endpoint: string, requestOptions: RequestOptions = {}): Promise<T> => {
    const { responseType = "auto", ...options } = requestOptions;
    const headers = new Headers(options.headers ?? {});

    const token = await authHeader(endpoint);
    if (token) headers.set("Authorization", `Bearer ${token}`);

    const rawBody = options.body;
    let body: BodyInit | undefined;
    if (rawBody === undefined || rawBody === null) {
      body = undefined;
    } else if (isFormData(rawBody)) {
      body = rawBody;
    } else if (typeof rawBody === "string") {
      body = rawBody;
      if (!headers.has("Content-Type")) headers.set("Content-Type", "application/json");
    } else {
      body = JSON.stringify(rawBody);
      if (!headers.has("Content-Type")) headers.set("Content-Type", "application/json");
    }

    const init: RequestInit = {
      ...options,
      headers,
      body,
      ...(config.useCredentials ? { credentials: "include" } : {}),
    };

    let response = await doFetch(`${resolveRoot()}${endpoint}`, init);

    // Reactive refresh + single retry on 401.
    if (response.status === 401 && !endpoint.includes("/auth/token/")) {
      const newToken = await refreshToken();
      if (newToken) {
        headers.set("Authorization", `Bearer ${newToken}`);
        response = await doFetch(`${resolveRoot()}${endpoint}`, { ...init, headers });
      }
    }

    if (!response.ok) {
      let parsedBody: unknown;
      try {
        parsedBody = await response.clone().json();
      } catch {
        parsedBody = undefined;
      }
      if (response.status === 500) config.onServerError?.(endpoint, response.clone());
      if (response.status === 401) {
        if (config.onUnauthorized) {
          await config.onUnauthorized(endpoint, response.clone());
        } else if (!endpoint.includes("/auth/token/obtain/")) {
          await tokens.clearTokens();
          config.onAuthError?.();
        }
      }
      throw new ApiError(
        response.status,
        endpoint,
        `API error: ${response.status} ${response.statusText}`,
        parsedBody,
        // A 500 is an unhandled exception; whatever its body says is not for users.
        response.status === 500 ? null : extractServerMessage(parsedBody)
      );
    }

    if (responseType === "blob") return (await response.blob()) as unknown as T;
    if (responseType === "text") return (await response.text()) as unknown as T;

    const contentType = response.headers.get("content-type") ?? "";
    if (contentType.includes("application/json")) {
      return (await response.json()) as T;
    }
    if (
      contentType.includes("application/octet-stream") ||
      contentType.includes("application/zip") ||
      contentType.includes("application/x-zip-compressed")
    ) {
      return (await response.blob()) as unknown as T;
    }
    return (await response.text()) as unknown as T;
  };

  return {
    request,
    get: <T>(endpoint: string) => request<T>(endpoint, { method: "GET" }),
    post: <T>(endpoint: string, data?: unknown) => request<T>(endpoint, { method: "POST", body: data }),
    patch: <T>(endpoint: string, data?: unknown) => request<T>(endpoint, { method: "PATCH", body: data }),
    delete: <T>(endpoint: string, data?: unknown) => request<T>(endpoint, { method: "DELETE", body: data }),
    getBlob: (endpoint: string) => request<Blob>(endpoint, { method: "GET", responseType: "blob" }),
    resolveBaseUrl: resolveRoot,
  };
}
