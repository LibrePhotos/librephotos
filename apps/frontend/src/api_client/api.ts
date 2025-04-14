import { 
  useMutation, 
  useQuery, 
  useQueryClient, 
  UseQueryOptions,
  UseMutationOptions,
  QueryClient,
  QueryKey
} from '@tanstack/react-query';
import { Cookies } from 'react-cookie';
import jwtDecode from 'jwt-decode';

import { notification } from "../service/notifications";
import { ImageTagResponse, ServerStatsResponse, StorageStatsResponse } from "./util.zod";

const API_BASE_URL = '/api';

// Custom fetch client with auth and refresh token functionality
class FetchClient {
  private isTokenExpired(exp: number): boolean {
    return 1000 * exp - new Date().getTime() < 5000;
  }

  private async refreshToken(): Promise<string | null> {
    const cookies = new Cookies();
    const refreshToken = cookies.get('refresh');
    
    if (!refreshToken) {
      return null;
    }

    try {
      const refreshResponse = await fetch(`${API_BASE_URL}/auth/token/refresh/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh: refreshToken }),
        credentials: 'include',
      });
      
      if (refreshResponse.ok) {
        const refreshData = await refreshResponse.json();
        cookies.set('access', refreshData.access);
        return refreshData.access;
      }
    } catch (error) {
      console.error('Token refresh failed', error);
    }
    return null;
  }

  private async handleAuthError(response: Response, endpoint: string, options: RequestInit): Promise<Response> {
    if (response.status === 401) {
      const newToken = await this.refreshToken();
      
      if (newToken) {
        // Retry the original request with new token
        const headers = new Headers(options.headers || {});
        headers.set('Authorization', `Bearer ${newToken}`);
        return fetch(`${API_BASE_URL}${endpoint}`, {
          ...options,
          headers,
          credentials: 'include',
        });
      }
    }
    return response;
  }

  private async handleError(response: Response, endpoint: string) {
    if (response.status === 500) {
      notification.requestFailed(
        `500 (Internal Server Error) for ${endpoint}`,
        "Something went wrong on the server. Please open up the network tab in your browser's developer tools and report this issue on GitHub."
      );
      throw new Error('Internal Server Error');
    }

    if (response.status === 401) {
      notification.invalidToken();
      // Logout the user by blacklisting the refresh token
      const cookies = new Cookies();
      const refreshToken = cookies.get('refresh');
      if (refreshToken) {
        try {
          await fetch(`${API_BASE_URL}/auth/token/blacklist/`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ refresh: refreshToken }),
            credentials: 'include',
          });
        } catch (error) {
          console.error('Logout failed:', error);
        }
      }
      // Clear auth cookies and redirect to login
      cookies.remove('access');
      cookies.remove('refresh');
      cookies.remove('jwt');
      window.location.href = '/login';
      
      throw new Error('Authentication failed');
    }

    const contentType = response.headers.get('content-type');
    if (contentType && contentType.includes('application/json')) {
      const data = await response.json();
      if (data.errors) {
        data.errors.forEach((error: { field: string; message: string }) => {
          if (error.field === 'detail') {
            const isLogin = endpoint.includes('/auth/login/');
            notification.authError(isLogin, error.field, error.message);
          }
        });
      }
    }
  }

  async request<T>(
    endpoint: string, 
    options: RequestInit = {}
  ): Promise<T> {
    const cookies = new Cookies();
    const accessToken = cookies.get('access');
    
    // Create headers with auth token if available
    const headers = new Headers(options.headers || {});
    if (accessToken && !endpoint.includes('/auth/token/refresh/')) {
      try {
        const decodedToken = jwtDecode<{ exp: number }>(accessToken);
        if (this.isTokenExpired(decodedToken.exp)) {
          const newToken = await this.refreshToken();
          if (newToken) {
            headers.set('Authorization', `Bearer ${newToken}`);
          }
        } else {
          headers.set('Authorization', `Bearer ${accessToken}`);
        }
      } catch (error) {
        console.error('Error decoding token:', error);
      }
    }
    
    if (!headers.has('Content-Type') && !options.body?.toString().includes('FormData')) {
      headers.set('Content-Type', 'application/json');
    }
    
    // Create the request config
    const config: RequestInit = {
      ...options,
      headers,
      credentials: 'include',
    };
    
    // Convert body to JSON string if it's an object
    if (config.body && typeof config.body === 'object' && !(config.body instanceof FormData)) {
      config.body = JSON.stringify(config.body);
    }
    
    try {
      let response = await fetch(`${API_BASE_URL}${endpoint}`, config);
      
      // Handle auth errors and token refresh
      response = await this.handleAuthError(response, endpoint, config);
      
      // Handle other errors
      if (!response.ok) {
        await this.handleError(response, endpoint);
        throw new Error(`API error: ${response.status} ${response.statusText}`);
      }
      
      // Handle different response types
      const contentType = response.headers.get('content-type');
      if (contentType && contentType.includes('application/json')) {
        return await response.json() as T;
      } else if (contentType && contentType.includes('application/octet-stream')) {
        return await response.blob() as unknown as T;
      } else {
        return await response.text() as unknown as T;
      }
    } catch (error) {
      console.error('Fetch error:', error);
      throw error;
    }
  }
  
  get<T>(endpoint: string): Promise<T> {
    return this.request<T>(endpoint, { method: 'GET' });
  }
  
  post<T>(endpoint: string, data?: any): Promise<T> {
    return this.request<T>(endpoint, {
      method: 'POST',
      body: data,
    });
  }
  
  patch<T>(endpoint: string, data: any): Promise<T> {
    return this.request<T>(endpoint, {
      method: 'PATCH',
      body: data,
    });
  }
  
  delete<T>(endpoint: string, data?: any): Promise<T> {
    return this.request<T>(endpoint, {
      method: 'DELETE',
      body: data,
    });
  }
}

const fetchClient = new FetchClient();
export { fetchClient };

// Query Keys
export enum QueryKeys {
  userList = 'userList',
  userSelfDetails = 'userSelfDetails',
  predefinedRules = 'predefinedRules',
  incompleteFaces = 'incompleteFaces',
  faces = 'faces',
  worker = 'worker',
  serverStats = 'serverStats',
  serverLogs = 'serverLogs',
  storageStats = 'storageStats',
  imageTag = 'imageTag',
  generateAutoAlbumTitle = 'generateAutoAlbumTitle',
  jobs = 'jobs',
  autoAlbums = 'autoAlbums',
  autoAlbum = 'autoAlbum',
  dateAlbums = 'dateAlbums',
  dateAlbum = 'dateAlbum',
  peopleAlbums = 'peopleAlbums',
  personAlbum = 'personAlbum',
  placesAlbums = 'placesAlbums',
  placeAlbum = 'placeAlbum',
  locationClusters = 'locationClusters',
  thingsAlbums = 'thingsAlbums',
  thingsAlbum = 'thingsAlbum',
  sharedAlbumsByMe = 'sharedAlbumsByMe',
  sharedAlbumsWithMe = 'sharedAlbumsWithMe',
  userAlbums = 'userAlbums',
  userAlbum = 'userAlbum',
  locationTimeline = 'locationTimeline',
  nextcloudDirs = 'nextcloudDirs',
  socialGraph = 'socialGraph',
  searchExamples = 'searchExamples',
  searchPhotos = 'searchPhotos',
  siteSettings = 'siteSettings',
  timezones = 'timezones',
  locationTree = 'locationTree',
  countStats = 'countStats',
  wordCloud = 'wordCloud',
  photoMonthCount = 'photoMonthCount',
}

// Create QueryClient
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000, // 5 minutes
      retry: 1,
    },
  },
});

// API endpoints
export const API = {
  // User & Auth
  
  fetchPredefinedRules: () => 
    fetchClient.get<string>('/predefinedrules/')
      .then(response => JSON.parse(response)),
  
};

// Hook factory for queries
function createQuery<TData, TParams extends any[] = []>(
  queryKey: QueryKey,
  queryFn: (...params: TParams) => Promise<TData>,
  options?: Omit<UseQueryOptions<TData, Error, TData, QueryKey>, 'queryKey' | 'queryFn'>
) {
  return (...params: TParams) => 
    useQuery({
      queryKey: Array.isArray(queryKey) ? [...queryKey, ...params] : [queryKey, ...params],
      queryFn: () => queryFn(...params),
      ...options
    });
}

// Hook factory for mutations
function createMutation<TData, TVariables, TContext = unknown>(
  mutationFn: (variables: TVariables) => Promise<TData>,
  options?: Omit<UseMutationOptions<TData, Error, TVariables, TContext>, 'mutationFn'>
) {
  return () => useMutation({
    mutationFn,
    ...options
  });
}

// Query Hooks
export const useFetchPredefinedRulesQuery = createQuery(
  [QueryKeys.predefinedRules],
  API.fetchPredefinedRules
);