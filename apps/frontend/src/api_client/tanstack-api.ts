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
import {
  ClusterFacesResponse,
  CompletePersonFace,
  CompletePersonFaceList,
  DeleteFacesRequest,
  DeleteFacesResponse,
  FacesTab,
  IncompletePersonFaceListRequest,
  IncompletePersonFaceListResponse,
  PersonFaceList,
  PersonFaceListRequest,
  PersonFaceListResponse,
  ScanFacesResponse,
  SetFacesLabelRequest,
  SetFacesLabelResponse,
  TrainFacesResponse,
} from "../store/faces/facesActions.types";
import type { IUploadOptions, IUploadResponse } from "../store/upload/upload.zod";
import { UploadExistResponse, UploadResponse } from "../store/upload/upload.zod";
import type { IManageUser, IUser, UserList } from "../store/user/user.zod";
import { ApiUserListResponseSchema, ManageUser, UserSchema } from "../store/user/user.zod";
import type { ImageTagResponseType, ServerStatsResponseType, StorageStatsResponseType } from "../store/util/util.zod";
import type { IWorkerAvailabilityResponse } from "../store/worker/worker.zod";

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

// Query Keys
export enum QueryKeys {
  userList = 'userList',
  userSelfDetails = 'userSelfDetails',
  predefinedRules = 'predefinedRules',
  incompleteFaces = 'incompleteFaces',
  faces = 'faces',
  worker = 'worker',
  isFirstTimeSetup = 'isFirstTimeSetup',
  clusterFaces = 'clusterFaces',
  rescanFaces = 'rescanFaces',
  serverStats = 'serverStats',
  serverLogs = 'serverLogs',
  storageStats = 'storageStats',
  imageTag = 'imageTag',
  uploadExists = 'uploadExists',
  generateAutoAlbumTitle = 'generateAutoAlbumTitle',
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
  
  // Upload
  uploadExists: (hash: string) => 
    fetchClient.get<string>(`/exists/${hash}`)
      .then(response => UploadExistResponse.parse(response).exists),
  
  uploadFinished: (formData: FormData) => 
    fetchClient.post('/upload/complete/', formData),
  
  upload: (options: IUploadOptions) => {
    const headers = new Headers({
      'Content-Range': `bytes ${options.offset}-${options.offset + options.chunk_size - 1}/${options.chunk_size}`,
    });
    
    return fetchClient.request<IUploadResponse>('/upload/', {
      method: 'POST',
      body: options.form_data,
      headers,
    }).then(response => UploadResponse.parse(response));
  },
  
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
  
  // Faces
  fetchIncompleteFaces: (params: IncompletePersonFaceListRequest) => {
    const { inferred = false, method = 'clustering', orderBy = 'confidence', minConfidence } = params;
    const url = `/faces/incomplete/?inferred=${inferred}${
      inferred ? `&analysis_method=${method}&order_by=${orderBy}` : ''
    }${minConfidence ? `&min_confidence=${minConfidence}` : ''}`;
    
    return fetchClient.get<IncompletePersonFaceListResponse>(url)
      .then(response => {
        const payload = IncompletePersonFaceListResponse.parse(response);
        const newFacesList: CompletePersonFaceList = payload.map(person => {
          const completePersonFace: CompletePersonFace = { ...person, faces: [] };
          for (let i = 0; i < person.face_count; i += 1) {
            completePersonFace.faces.push({
              id: i,
              image: null,
              face_url: null,
              photo: '',
              person_label_probability: 1,
              person: person.id,
              isTemp: true,
            });
          }
          return completePersonFace;
        });
        return newFacesList;
      });
  },
  
  fetchFaces: (params: PersonFaceListRequest) => {
    const { person, page = 0, inferred = false, orderBy = 'confidence', method, minConfidence } = params;
    const url = `/faces/?person=${person}&page=${page}&inferred=${inferred}&order_by=${orderBy}${
      method ? `&analysis_method=${method}` : ''
    }${minConfidence ? `&min_confidence=${minConfidence}` : ''}`;
    
    return fetchClient.get(url)
      .then(response => {
        const parsedResponse = PersonFaceListResponse.parse(response);
        return parsedResponse.results;
      });
  },
  
  deleteFaces: (data: DeleteFacesRequest) => 
    fetchClient.post<DeleteFacesResponse>('/deletefaces', { face_ids: data.faceIds })
      .then(response => DeleteFacesResponse.parse(response)),
  
  setFacesPersonLabel: (data: SetFacesLabelRequest) => 
    fetchClient.post<SetFacesLabelResponse>('/labelfaces', { 
      person_name: data.personName, 
      face_ids: data.faceIds 
    }).then(response => {
      const payload = SetFacesLabelResponse.parse(response);
      notification.addFacesToPerson(payload.results[0].person_name ?? 'unknown', payload.results.length);
      return payload;
    }),
  
  clusterFaces: () => 
    fetchClient.get<ClusterFacesResponse>('/clusterfaces'),
  
  rescanFaces: () => 
    fetchClient.get<ScanFacesResponse>('/scanfaces'),
  
  trainFaces: () => 
    fetchClient.post<TrainFacesResponse>('/trainfaces'),
  
  generateAutoAlbumTitle: () => 
    fetchClient.get<IGenerateEventAlbumsTitlesResponse>('/autoalbumtitlegen'),
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

export const useUploadMutation = createMutation(API.upload);

export const useUploadFinishedMutation = createMutation(API.uploadFinished);

export const useSetFacesPersonLabelMutation = createMutation(API.setFacesPersonLabel, {
  onSuccess: () => {
    queryClient.invalidateQueries({ queryKey: [QueryKeys.faces] });
    // Also invalidate PeopleAlbums if you add that query
  }
});

export const useTrainFacesMutation = createMutation(API.trainFaces);

export const useDeleteFacesMutation = createMutation<
  DeleteFacesResponse, 
  DeleteFacesRequest, 
  { previousIncompleteFaces?: CompletePersonFaceList }
>(
  API.deleteFaces, 
  {
    onMutate: async (variables) => {
      // Get the current query client
      const queryClient = useQueryClient();
      
      // Cancel any outgoing refetches for incompleteFaces
      await queryClient.cancelQueries({ queryKey: [QueryKeys.incompleteFaces] });
      
      // Snapshot the previous value
      const previousIncompleteFaces = queryClient.getQueryData([QueryKeys.incompleteFaces]);
      
      // Optimistically update the cache
      queryClient.setQueryData<CompletePersonFaceList>([QueryKeys.incompleteFaces], old => {
        if (!old) return old;
        
        return old.map(personGroup => ({
          ...personGroup,
          faces: personGroup.faces.filter(face => !variables.faceIds.includes(face.id)),
          face_count: personGroup.faces.filter(face => !variables.faceIds.includes(face.id)).length
        })).filter(personGroup => personGroup.faces.length > 0);
      });
      
      return { previousIncompleteFaces };
    },
    
    onError: (_err, _variables, context) => {
      if (context?.previousIncompleteFaces) {
        queryClient.setQueryData([QueryKeys.incompleteFaces], context.previousIncompleteFaces);
      }
    }
  }
);

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

export const useUploadExistsQuery = createQuery(
  [QueryKeys.uploadExists],
  API.uploadExists
);

export const useWorkerQuery = createQuery(
  [QueryKeys.worker],
  API.worker
);

export const useIsFirstTimeSetupQuery = createQuery(
  [QueryKeys.isFirstTimeSetup],
  API.isFirstTimeSetup
);

export const useFetchIncompleteFacesQuery = createQuery<CompletePersonFaceList, [IncompletePersonFaceListRequest]>(
  [QueryKeys.incompleteFaces],
  API.fetchIncompleteFaces
);

export const useFetchFacesQuery = (...params: [PersonFaceListRequest]) => 
  useQuery({
    queryKey: [QueryKeys.faces, ...params],
    queryFn: () => API.fetchFaces(...params),
    onSuccess: (data, variables) => {
      // Update incompleteFaces cache when fetching faces
      const queryClient = useQueryClient();
      const incompleteParams: IncompletePersonFaceListRequest = {
        method: params[0].method,
        orderBy: params[0].orderBy,
        inferred: params[0].inferred,
        minConfidence: params[0].minConfidence,
      };

      const incompleteData = queryClient.getQueryData<CompletePersonFaceList>(
        [QueryKeys.incompleteFaces, incompleteParams]
      );

      if (incompleteData) {
        queryClient.setQueryData<CompletePersonFaceList>(
          [QueryKeys.incompleteFaces, incompleteParams], 
          draft => {
            if (!draft) return draft;
            const indexToReplace = draft.findIndex(group => group.id === params[0].person);
            if (indexToReplace === -1) return draft;

            const groupToChange = draft[indexToReplace];
            const { faces } = groupToChange;
            const newFaces = [
              ...faces.slice(0, (params[0].page - 1) * 100),
              ...data,
              ...faces.slice(params[0].page * 100)
            ];
            
            const updatedGroup = { ...groupToChange, faces: newFaces };
            
            return [
              ...draft.slice(0, indexToReplace),
              updatedGroup,
              ...draft.slice(indexToReplace + 1)
            ];
          }
        );
      }
    }
  });

export const useClusterFacesQuery = createQuery(
  [QueryKeys.clusterFaces],
  API.clusterFaces
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