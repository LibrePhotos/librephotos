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
  /** Called on 500 responses (surface a notification, etc.). */
  onServerError?: (endpoint: string, response: Response) => void;
}

export type RequestOptions = Omit<RequestInit, "body"> & {
  /** Object bodies are JSON-encoded automatically; FormData / string pass through. */
  body?: unknown;
};

export interface ApiClient {
  request<T>(endpoint: string, options?: RequestOptions): Promise<T>;
  get<T>(endpoint: string): Promise<T>;
  post<T>(endpoint: string, data?: unknown): Promise<T>;
  patch<T>(endpoint: string, data?: unknown): Promise<T>;
  delete<T>(endpoint: string, data?: unknown): Promise<T>;
  /** Resolve the current `<baseUrl>/api` root — handy for building media URLs. */
  resolveBaseUrl(): string;
}
