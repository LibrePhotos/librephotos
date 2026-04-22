import { QueryClient } from '@tanstack/react-query'
import { jwtDecode } from 'jwt-decode'
import { notification } from '../service/notifications'
import { useAuthStore } from '../stores/authStore'
import { tokenStorage } from './platform/tokenStorage'
import { getApiBaseUrl } from './platform/config'
import { platformNavigation } from './platform/navigation'

// Mutex to prevent concurrent token refresh races
let isRefreshing = false
let refreshPromise: Promise<string | null> | null = null

class FetchClient {
  private static isTokenExpired(exp: number): boolean {
    return 1000 * exp - new Date().getTime() < 5000
  }

  private static async refreshToken(): Promise<string | null> {
    // If already refreshing, wait for the existing refresh to complete
    if (isRefreshing && refreshPromise) {
      return refreshPromise
    }

    isRefreshing = true
    refreshPromise = (async () => {
      const refreshToken = await tokenStorage.getRefreshToken()

      if (!refreshToken) {
        return null
      }

      try {
        const refreshResponse = await fetch(
          `${getApiBaseUrl()}/auth/token/refresh/`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ refresh: refreshToken }),
          },
        )

        if (refreshResponse.ok) {
          const refreshData = await refreshResponse.json()
          await tokenStorage.setAccessToken(refreshData.access)
          useAuthStore.getState().tokenReceived({ access: refreshData.access })
          return refreshData.access
        }
      } catch (error) {
        console.error('Token refresh failed', error)
      }
      return null
    })()

    try {
      return await refreshPromise
    } finally {
      isRefreshing = false
      refreshPromise = null
    }
  }

  private static async handleAuthError(
    response: Response,
    endpoint: string,
    options: RequestInit,
  ): Promise<Response> {
    if (response.status === 401) {
      const newToken = await FetchClient.refreshToken()

      if (newToken) {
        const headers = new Headers(options.headers || {})
        headers.set('Authorization', `Bearer ${newToken}`)
        return fetch(`${getApiBaseUrl()}${endpoint}`, {
          ...options,
          headers,
        })
      }
    }
    return response
  }

  private static async handleError(response: Response, endpoint: string) {
    if (response.status === 500) {
      notification.requestFailed(
        `500 (Internal Server Error) for ${endpoint}`,
        'Something went wrong on the server. Please report this issue on GitHub.',
      )
      throw new Error('Internal Server Error')
    }

    if (response.status === 401) {
      const isPublicPage = platformNavigation.isPublicPage()
      const isLoginPage = platformNavigation.isLoginPage()
      const isSignupPage = platformNavigation.isSignupPage()
      const suppressAuthNotifications =
        isPublicPage || isLoginPage || isSignupPage

      if (!isPublicPage) {
        // Logout the user by blacklisting the refresh token
        const refreshToken = await tokenStorage.getRefreshToken()
        if (refreshToken) {
          try {
            await fetch(`${getApiBaseUrl()}/auth/token/blacklist/`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ refresh: refreshToken }),
            })
          } catch (error) {
            console.error('Logout failed:', error)
          }
        }
        // Clear tokens and redirect to login
        if (!isLoginPage) {
          await tokenStorage.clearTokens()
          useAuthStore.getState().logout()
          platformNavigation.navigateToLogin()
        }

        if (!suppressAuthNotifications) {
          try {
            const data = await response.json()
            if (data.errors) {
              data.errors.forEach(
                (error: { field: string; message: string }) => {
                  if (error.field === 'detail') {
                    const isLogin = endpoint.includes('/auth/token/obtain/')
                    notification.authError(isLogin, error.field, error.message)
                  }
                },
              )
            } else {
              notification.invalidToken()
            }
          } catch {
            notification.invalidToken()
          }
        }
        throw new Error('Authentication failed')
      }
      throw new Error('Not authenticated (public page)')
    }
  }

  // Ensure the path portion of the endpoint has a trailing slash
  // to avoid Django 301 redirects (APPEND_SLASH).
  private static normalizeEndpoint(endpoint: string): string {
    const [path, query] = endpoint.split('?')
    const normalizedPath = path.endsWith('/') ? path : path + '/'
    return query !== undefined ? `${normalizedPath}?${query}` : normalizedPath
  }

  static async request<T>(
    endpoint: string,
    options: RequestInit = {},
  ): Promise<T> {
    endpoint = FetchClient.normalizeEndpoint(endpoint)
    const accessToken = await tokenStorage.getAccessToken()

    const headers = new Headers(options.headers || {})
    if (accessToken && !endpoint.includes('/auth/token/refresh/')) {
      try {
        const decodedToken = jwtDecode<{ exp: number }>(accessToken)
        if (FetchClient.isTokenExpired(decodedToken.exp)) {
          const newToken = await FetchClient.refreshToken()
          if (newToken) {
            headers.set('Authorization', `Bearer ${newToken}`)
          }
        } else {
          headers.set('Authorization', `Bearer ${accessToken}`)
        }
      } catch (error) {
        console.error('Error decoding token:', error)
      }
    }

    if (!headers.has('Content-Type') && !(options.body instanceof FormData)) {
      headers.set('Content-Type', 'application/json')
    }

    const config: RequestInit = {
      ...options,
      headers,
    }

    // Convert body to JSON string if it's an object (not FormData)
    if (
      config.body &&
      typeof config.body === 'object' &&
      !(config.body instanceof FormData)
    ) {
      config.body = JSON.stringify(config.body)
    }

    try {
      let response = await fetch(`${getApiBaseUrl()}${endpoint}`, config)

      response = await FetchClient.handleAuthError(response, endpoint, config)

      if (!response.ok) {
        await FetchClient.handleError(response, endpoint)
        throw new Error(`API error: ${response.status} ${response.statusText}`)
      }

      const contentType = response.headers.get('content-type')
      if (contentType && contentType.includes('application/json')) {
        return (await response.json()) as T
      }
      if (
        contentType &&
        (contentType.includes('application/octet-stream') ||
          contentType.includes('application/x-zip-compressed') ||
          contentType.includes('application/zip'))
      ) {
        return (await response.blob()) as unknown as T
      }
      return (await response.text()) as unknown as T
    } catch (error) {
      console.error('Fetch error:', error)
      throw error
    }
  }

  request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
    return (this.constructor as typeof FetchClient).request<T>(
      endpoint,
      options,
    )
  }

  get<T>(endpoint: string): Promise<T> {
    return (this.constructor as typeof FetchClient).request<T>(endpoint, {
      method: 'GET',
    })
  }

  post<T>(endpoint: string, data?: any): Promise<T> {
    return (this.constructor as typeof FetchClient).request<T>(endpoint, {
      method: 'POST',
      body: data,
    })
  }

  patch<T>(endpoint: string, data: any): Promise<T> {
    return (this.constructor as typeof FetchClient).request<T>(endpoint, {
      method: 'PATCH',
      body: data,
    })
  }

  delete<T>(endpoint: string, data?: any): Promise<T> {
    return (this.constructor as typeof FetchClient).request<T>(endpoint, {
      method: 'DELETE',
      body: data,
    })
  }
}

const fetchClient = new FetchClient()
export { fetchClient }

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000, // 5 minutes
      retry: 1,
      refetchOnWindowFocus: false, // Not applicable on mobile
      refetchOnReconnect: true,
    },
  },
})
