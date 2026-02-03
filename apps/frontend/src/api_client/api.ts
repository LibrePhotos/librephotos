import { QueryClient } from "@tanstack/react-query";
import jwtDecode from "jwt-decode";
import { Cookies } from "react-cookie";
import { notification } from "../service/notifications";

const API_BASE_URL = "/api";

// Custom fetch client with auth and refresh token functionality
class FetchClient {
  private static isTokenExpired(exp: number): boolean {
    return 1000 * exp - new Date().getTime() < 5000;
  }

  private static async refreshToken(): Promise<string | null> {
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
      // eslint-disable-next-line no-console
      console.error("Token refresh failed", error);
    }
    return null;
  }

  private static async handleAuthError(response: Response, endpoint: string, options: RequestInit): Promise<Response> {
    if (response.status === 401) {
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

  private static async handleError(response: Response, endpoint: string) {
    if (response.status === 500) {
      notification.requestFailed(
        `500 (Internal Server Error) for ${endpoint}`,
        "Something went wrong on the server. Please open up the network tab in your browser's developer tools and report this issue on GitHub."
      );
      throw new Error("Internal Server Error");
    }

    if (response.status === 401) {
      // Check if we're on a public page or auth pages - don't handle 401 as an error there
      const isPublicPage = window.location.pathname.startsWith("/public");
      const isLoginPage = window.location.pathname.includes("/login");
      const isSignupPage = window.location.pathname.includes("/signup");
      const suppressAuthNotifications = isPublicPage || isLoginPage || isSignupPage;

      if (!isPublicPage) {
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
            // eslint-disable-next-line no-console
            console.error("Logout failed:", error);
          }
        }
        // Clear auth cookies and redirect to login if we are not already on the login page
        if (!isLoginPage) {
          cookies.remove("access");
          cookies.remove("refresh");
          cookies.remove("jwt");
          window.location.href = "/login";
        }

        // Only show notifications when NOT on a public/login/signup page
        if (!suppressAuthNotifications) {
          const data = await response.json();
          if (data.errors) {
            data.errors.forEach((error: { field: string; message: string }) => {
              if (error.field === "detail") {
                const isLogin = endpoint.includes("/auth/token/obtain/");
                notification.authError(isLogin, error.field, error.message);
              }
            });
          } else {
            notification.invalidToken();
          }
        }
        throw new Error("Authentication failed");
      }
      // On public pages, silently ignore 401 errors for authenticated-only endpoints
      // Return a response that will result in undefined/null data
      throw new Error("Not authenticated (public page)");
    }
  }

  static async request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
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
        // eslint-disable-next-line no-console
        console.error("Error decoding token:", error);
      }
    }

    if (!headers.has("Content-Type") && !options.body?.toString().includes("FormData")) {
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
        throw new Error(`API error: ${response.status} ${response.statusText}`);
      }

      // Handle different response types
      const contentType = response.headers.get("content-type");
      if (contentType && contentType.includes("application/json")) {
        return (await response.json()) as T;
      }
      if (contentType && contentType.includes("application/octet-stream")) {
        return (await response.blob()) as unknown as T;
      }
      return (await response.text()) as unknown as T;
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error("Fetch error:", error);
      // eslint-disable-next-line no-console
      console.trace();
      throw error;
    }
  }

  request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
    return (this.constructor as typeof FetchClient).request<T>(endpoint, options);
  }

  get<T>(endpoint: string): Promise<T> {
    return (this.constructor as typeof FetchClient).request<T>(endpoint, { method: "GET" });
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
