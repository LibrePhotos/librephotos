/**
 * Platform-agnostic transport configuration.
 *
 * The web app and the mobile app each provide their own implementation:
 *  - web injects cookies (credentials: "include") and reads tokens from cookies;
 *  - mobile injects an Authorization header and reads tokens from expo-secure-store.
 *
 * This module must stay React-free and RN-free (zod is fine, but no react,
 * no react-dom, no react-native). Everything the client needs is injected.
 */

/** Supplies auth tokens. All methods may be async (secure storage is async on mobile). */
export interface TokenSupplier {
  /** Current access token, or null when logged out. */
  getAccessToken(): string | null | Promise<string | null>;
  /** Current refresh token, or null when logged out. */
  getRefreshToken(): string | null | Promise<string | null>;
  /** Persist a freshly refreshed access token. */
  setAccessToken(token: string): void | Promise<void>;
  /** Clear all tokens (called on unrecoverable auth failure / logout). */
  clearTokens(): void | Promise<void>;
}

export interface ApiClientConfig {
  /**
   * Base server URL WITHOUT the trailing `/api` (e.g. "https://demo.librephotos.com").
   * A function is allowed so the self-hosted server URL can change at runtime.
   */
  baseUrl: string | (() => string);
  tokens: TokenSupplier;
  /**
   * Injected fetch. Defaults to the global `fetch`. Injectable so tests and
   * non-standard runtimes can substitute their own.
   */
  fetch?: typeof fetch;
  /**
   * When true, send `credentials: "include"` (web/cookie transport). Mobile
   * leaves this false and relies purely on the Authorization header.
   */
  useCredentials?: boolean;
  /** Called after a refresh fails and tokens are cleared (e.g. navigate to login). */
  onAuthError?: () => void;
  /**
   * Replaces the default handling of a 401 that survived the refresh (clear the
   * tokens and call `onAuthError`, except when the login endpoint itself
   * rejected the credentials). For a platform that decides on its own whether
   * a 401 logs the user out: the web keeps its cookies on public pages and
   * blacklists the refresh token first. Called for every such 401, the login
   * endpoint included, with a clone of the response. The request still rejects
   * with an ApiError afterwards; a hook that throws rejects it with that error.
   */
  onUnauthorized?: (endpoint: string, response: Response) => void | Promise<void>;
  /** Called on 500 responses (surface a notification, etc.). Gets a clone of the response. */
  onServerError?: (endpoint: string, response: Response) => void;
}

/**
 * How to read a successful response body. "auto" (the default) picks by
 * Content-Type; "blob" and "text" force a type, e.g. for a file download whose
 * Content-Type depends on the server's mimetype guess.
 */
export type ResponseType = "auto" | "blob" | "text";

export type RequestOptions = Omit<RequestInit, "body"> & {
  /**
   * Object bodies are JSON-encoded automatically. FormData passes through with
   * no Content-Type (the runtime adds the multipart boundary); a string passes
   * through as JSON unless a Content-Type header says otherwise.
   */
  body?: unknown;
  /** Not sent to fetch; see ResponseType. */
  responseType?: ResponseType;
};

export interface ApiClient {
  request<T>(endpoint: string, options?: RequestOptions): Promise<T>;
  get<T>(endpoint: string): Promise<T>;
  post<T>(endpoint: string, data?: unknown): Promise<T>;
  patch<T>(endpoint: string, data?: unknown): Promise<T>;
  delete<T>(endpoint: string, data?: unknown): Promise<T>;
  /** GET a file (e.g. a download) as a Blob, whatever Content-Type the server sends. */
  getBlob(endpoint: string): Promise<Blob>;
  /** Resolve the current `<baseUrl>/api` root — handy for building media URLs. */
  resolveBaseUrl(): string;
}
