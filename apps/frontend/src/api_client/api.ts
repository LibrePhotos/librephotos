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

import type { IGenerateEventAlbumsTitlesResponse } from "../actions/utilActions.types";
import { notification } from "../service/notifications";
import type {
  IApiDeleteUserPost,
  IApiLoginPost,
  IApiLoginResponse,
  UserSignupRequest,
  UserSignupResponse,
} from "../store/auth/auth.zod";
import { ApiLoginResponseSchema, UserSignupResponseSchema } from "../store/auth/auth.zod";
import type { IManageUser, IUser, UserList } from "../store/user/user.zod";
import { ApiUserListResponseSchema, ManageUser, UserSchema } from "../store/user/user.zod";
import type { ImageTagResponseType, ServerStatsResponseType, StorageStatsResponseType } from "../store/util/util.zod";
import type { IWorkerAvailabilityResponse } from "../store/worker/worker.zod";
import { JobRequest, JobsResponse, JobsResponseSchema } from "./admin-jobs-schema";
import { AutoAlbumSchema, AutoAlbum, FetchAutoAlbumsListResponseSchema } from "../actions/albumActions.types";

const API_BASE_URL = '/api';

// Custom fetch client with auth and refresh token functionality
class FetchClient {
  async request<T>(
    endpoint: string, 
    options: RequestInit = {}
  ): Promise<T> {
    const cookies = new Cookies();
    const accessToken = cookies.get('access');
    
    // Create headers with auth token if available
    const headers = new Headers(options.headers || {});
    if (accessToken && !endpoint.includes('/auth/token/refresh/')) {
      headers.set('Authorization', `Bearer ${accessToken}`);
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
      const response = await fetch(`${API_BASE_URL}${endpoint}`, config);
      
      // Handle 401 by trying to refresh token
      if (response.status === 401) {
        const refreshToken = cookies.get('refresh');
        
        if (refreshToken) {
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
              
              // Retry the original request with new token
              headers.set('Authorization', `Bearer ${refreshData.access}`);
              return this.request<T>(endpoint, options);
            }
          } catch (error) {
            console.error('Token refresh failed', error);
          }
        }
      }
      
      if (!response.ok) {
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
  isFirstTimeSetup = 'isFirstTimeSetup',
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
  signUp: (data: UserSignupRequest) => 
    fetchClient.post<UserSignupResponse>('/user/', data)
      .then(response => UserSignupResponseSchema.parse(response)),
  
  login: (credentials: IApiLoginPost) => 
    fetchClient.post<IApiLoginResponse>('/auth/token/obtain/', credentials)
      .then(response => {
        const data = ApiLoginResponseSchema.parse(response);
        const cookies = new Cookies();
        cookies.set('access', data.access);
        cookies.set('refresh', data.refresh);
        return data;
      }),
  
  logout: () => {
    const cookies = new Cookies();
    return fetchClient.post('/auth/token/blacklist/', { refresh: cookies.get('refresh') });
  },
  
  fetchUserList: () => 
    fetchClient.get<UserList>('/user/')
      .then(response => ApiUserListResponseSchema.parse(response).results),
  
  fetchUserSelfDetails: (userId: string) => 
    fetchClient.get<IUser>(`/user/${userId}/`)
      .then(response => UserSchema.parse(response)),
  
  manageUpdateUser: (data: IManageUser) => 
    fetchClient.patch<IManageUser>(`/manage/user/${data.id}/`, data)
      .then(response => ManageUser.parse(response)),
  
  deleteUser: (data: IApiDeleteUserPost) => 
    fetchClient.delete(`/delete/user/${data.id}/`, data),
  
  // Setup & Config
  isFirstTimeSetup: () => 
    fetchClient.get<{ isFirstTimeSetup: boolean }>('/firsttimesetup/')
      .then(response => response.isFirstTimeSetup),
  
  fetchPredefinedRules: () => 
    fetchClient.get<string>('/predefinedrules/')
      .then(response => JSON.parse(response)),
  
  // Worker & System
  worker: () => 
    fetchClient.get<IWorkerAvailabilityResponse>('/rqavailable/'),
  
  fetchServerStats: () => 
    fetchClient.get<ServerStatsResponseType>('/serverstats'),
  
  fetchServerLogs: () => 
    fetch(`${API_BASE_URL}/serverlogs`, { 
      credentials: 'include',
      headers: {
        'Authorization': `Bearer ${new Cookies().get('access')}`
      }
    }).then(response => response.blob()),
  
  fetchStorageStats: () => 
    fetchClient.get<StorageStatsResponseType>('/storagestats'),
  
  fetchImageTag: () => 
    fetchClient.get<ImageTagResponseType>('/imagetag'),
  
  
  generateAutoAlbumTitle: () => 
    fetchClient.get<IGenerateEventAlbumsTitlesResponse>('/autoalbumtitlegen'),
  
  // Jobs
  fetchJobs: (params: JobRequest) => 
    fetchClient.get(`/jobs/?page_size=${params.pageSize || 10}&page=${params.page || 0}`)
      .then(response => JobsResponseSchema.parse(response)),
  
  deleteJob: (id: number) => 
    fetchClient.delete(`/jobs/${id}/`),
  
  // Auto Albums
  fetchAutoAlbums: () => 
    fetchClient.get('/albums/auto/list/')
      .then(response => FetchAutoAlbumsListResponseSchema.parse(response).results),
      
  fetchAutoAlbum: (id: string) => 
    fetchClient.get<AutoAlbum>(`/albums/auto/${id}/`)
      .then(response => AutoAlbumSchema.parse(response)),
      
  deleteAutoAlbum: ({ id, albumTitle }: { id: string; albumTitle: string }) => 
    fetchClient.delete(`/albums/auto/${id}/`)
      .then(() => {
        notification.deleteAlbum(albumTitle);
      }),
      
  deleteAllAutoAlbums: () => 
    fetchClient.post('/albums/auto/delete_all/')
      .then(() => {
        notification.deleteAutogeneratedAlbums();
      }),
      
  generateAutoAlbums: () => 
    fetchClient.post('/autoalbumgen/')
      .then(() => {
        notification.generateEventAlbums();
      }),
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
export const useSignUpMutation = createMutation(API.signUp, {
  onSuccess: () => {
    queryClient.invalidateQueries({ queryKey: [QueryKeys.isFirstTimeSetup] });
    queryClient.invalidateQueries({ queryKey: [QueryKeys.userList] });
  }
});

export const useLoginMutation = createMutation(API.login);

export const useLogoutMutation = createMutation(API.logout);

export const useManageUpdateUserMutation = createMutation(API.manageUpdateUser, {
  onSuccess: () => {
    queryClient.invalidateQueries({ queryKey: [QueryKeys.userList] });
  }
});

export const useDeleteUserMutation = createMutation(API.deleteUser, {
  onSuccess: () => {
    queryClient.invalidateQueries({ queryKey: [QueryKeys.userList] });
  }
});

export const useFetchUserListQuery = createQuery(
  [QueryKeys.userList],
  API.fetchUserList
);

export const useFetchUserSelfDetailsQuery = createQuery(
  [QueryKeys.userSelfDetails],
  API.fetchUserSelfDetails
);

export const useFetchPredefinedRulesQuery = createQuery(
  [QueryKeys.predefinedRules],
  API.fetchPredefinedRules
);


export const useWorkerQuery = createQuery(
  [QueryKeys.worker],
  API.worker
);

export const useIsFirstTimeSetupQuery = createQuery(
  [QueryKeys.isFirstTimeSetup],
  API.isFirstTimeSetup
);

export const useRescanFacesQuery = createQuery(
  [QueryKeys.rescanFaces],
  API.rescanFaces
);

export const useFetchServerStatsQuery = createQuery(
  [QueryKeys.serverStats],
  API.fetchServerStats
);

export const useFetchServerLogsQuery = createQuery(
  [QueryKeys.serverLogs],
  API.fetchServerLogs
);

export const useFetchStorageStatsQuery = createQuery(
  [QueryKeys.storageStats],
  API.fetchStorageStats
);

export const useFetchImageTagQuery = createQuery(
  [QueryKeys.imageTag],
  API.fetchImageTag
);

export const useGenerateAutoAlbumTitleQuery = createQuery(
  [QueryKeys.generateAutoAlbumTitle],
  API.generateAutoAlbumTitle
);

export const useJobsQuery = (params: JobRequest, options?: { pollingInterval?: number }) => 
  useQuery<JobsResponse>({
    queryKey: [QueryKeys.jobs, params],
    queryFn: () => API.fetchJobs(params),
    refetchInterval: options?.pollingInterval,
  });

export const useDeleteJobMutation = createMutation<unknown, number>(
  API.deleteJob,
  {
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [QueryKeys.jobs] });
    }
  }
);

export const useFetchAutoAlbumsQuery = createQuery(
  [QueryKeys.autoAlbums],
  API.fetchAutoAlbums
);

export const useFetchAutoAlbumQuery = (id: string) => 
  useQuery({
    queryKey: [QueryKeys.autoAlbum, id],
    queryFn: () => API.fetchAutoAlbum(id),
    enabled: !!id
  });

export const useLazyFetchAutoAlbumQuery = () => {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: [QueryKeys.autoAlbum],
    queryFn: () => Promise.resolve(undefined),
    enabled: false
  });

  const fetch = (id: string) => {
    return API.fetchAutoAlbum(id).then(data => {
      queryClient.setQueryData([QueryKeys.autoAlbum, id], data);
      return data;
    });
  };

  return [fetch, query] as const;
};

export const useDeleteAutoAlbumMutation = createMutation(
  API.deleteAutoAlbum,
  {
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [QueryKeys.autoAlbums] });
      queryClient.invalidateQueries({ queryKey: [QueryKeys.autoAlbum] });
    }
  }
);

export const useDeleteAllAutoAlbumsMutation = createMutation<unknown, void>(
  () => API.deleteAllAutoAlbums(),
  {
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [QueryKeys.autoAlbums] });
      queryClient.invalidateQueries({ queryKey: [QueryKeys.autoAlbum] });
    }
  }
);

export const useGenerateAutoAlbumsMutation = createMutation<unknown, void>(
  () => API.generateAutoAlbums(),
  {
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [QueryKeys.autoAlbums] });
    }
  }
); 