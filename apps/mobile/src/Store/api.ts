import type { BaseQueryResult } from '@reduxjs/toolkit/dist/query/baseQueryTypes'
import type { FetchBaseQueryError } from '@reduxjs/toolkit/query'
import type { BaseQueryFn, FetchArgs } from '@reduxjs/toolkit/query/react'
import { createApi, fetchBaseQuery } from '@reduxjs/toolkit/query/react'
import CookieManager from '@react-native-cookies/cookies'

import type {
  IApiDeleteUserPost,
  IApiLoginPost,
  IApiLoginResponse,
  UserSignupRequest,
  UserSignupResponse,
  IApiRefreshPost,
  IApiRefreshResponse,
} from '../Store/Auth/auth.zod'
import { UserSignupResponseSchema } from '../Store/Auth/auth.zod'
import { tokenReceived } from '../Store/Auth/authSlice'
import type {
  IClusterFacesResponse,
  IDeleteFacesRequest,
  IDeleteFacesResponse,
  IIncompletePersonFaceListRequest,
  IIncompletePersonFaceListResponse,
  IPersonFaceListRequest,
  IPersonFaceListResponse,
  IScanFacesResponse,
  ISetFacesLabelRequest,
  ISetFacesLabelResponse,
  ITrainFacesResponse,
} from '../Store/Faces/facesActions.types'
import { RootState } from '../Store/store'
import type {
  IUploadOptions,
  IUploadResponse,
} from '../Store/Upload/upload.zod'
import { UploadExistResponse, UploadResponse } from '../Store/Upload/upload.zod'
import type {
  IApiUserListResponse,
  IManageUser,
  IUser,
} from '../Store/User/user.zod'
import { ManageUser, UserSchema } from '../Store/User/user.zod'
import type { IWorkerAvailabilityResponse } from '../Store/Worker/worker.zod'
import Server from '../Services/index'

export enum Endpoints {
  login = 'login',
  signUp = 'signUp',
  fetchUserList = 'fetchUserList',
  fetchUserSelfDetails = 'fetchUserSelfDetails',
  fetchPredefinedRules = 'fetchPredefinedRules',
  refreshAccessToken = 'refreshAccessToken',
  uploadExists = 'uploadExists',
  uploadFinished = 'uploadFinished',
  upload = 'upload',
  worker = 'worker',
  deleteUser = 'deleteUser',
  manageUpdateUser = 'manageUpdateUser',
  jobs = 'jobs',
  incompleteFaces = 'fetchIncompleteFaces',
  isFirstTimeSetup = 'isFirstTimeSetup',
  fetchFaces = 'fetchFaces',
  clusterFaces = 'clusterFaces',
  rescanFaces = 'rescanFaces',
  trainFaces = 'trainFaces',
  deleteFaces = 'deleteFaces',
  notThisPerson = 'notThisPerson',
  setFacesPersonLabel = 'setFacesPersonLabel',
}
const baseQuery = fetchBaseQuery({
  baseUrl: '/api/',
  headers: {
    'Content-Type': 'application/json',
  },
  credentials: 'include',

  prepareHeaders: (headers, { getState, endpoint }) => {
    // To-Do: Check this
    CookieManager.get((getState() as RootState).config.baseurl).then(res => {
      res.csrftoken && headers.set('X-CSRFToken', res.csrftoken.value)
    })
    const { user } = getState() as RootState
    const { access } = (getState() as RootState).auth
    if (access !== null && user && endpoint !== 'refresh') {
      r
      headers.set('Authorization', `Bearer ${access.token}`)
    }
    return headers
  },
})

export const baseQueryWithReauth: BaseQueryFn<
  string | FetchArgs,
  unknown,
  FetchBaseQueryError
> = async (args, api, extraOptions) => {
  // set the base url dynamically
  const baseUrl = (api.getState() as RootState).config.baseurl + '/api/'
  const rawBaseQuery = fetchBaseQuery({ baseUrl })
  let result = await rawBaseQuery(args, api, extraOptions)

  if (result.error && result.error.status === 401) {
    // try to get a new token
    const refreshToken: string = (api.getState() as RootState).auth?.refresh
      ?.token
    if (refreshToken) {
      const refreshResult = await baseQuery(
        {
          url: '/auth/token/refresh/',
          method: 'POST',
          body: { refresh: refreshToken },
        },
        api,
        extraOptions,
      )
      if (refreshResult.data) {
        // store the new token
        api.dispatch(tokenReceived(refreshResult.data))
        // retry the initial query
        result = await baseQuery(args, api, extraOptions)
      }
    }
  }
  return result
}

export const api = createApi({
  reducerPath: 'api',
  baseQuery: baseQueryWithReauth,
  tagTypes: ['UserList', 'FirstTimeSetup'],
  endpoints: builder => ({
    [Endpoints.signUp]: builder.mutation<UserSignupResponse, UserSignupRequest>(
      {
        query: body => ({
          method: 'POST',
          body: body,
          url: '/user/',
        }),
        transformResponse: response => UserSignupResponseSchema.parse(response),
        invalidatesTags: ['FirstTimeSetup'],
      },
    ),
    [Endpoints.manageUpdateUser]: builder.mutation<IManageUser, IManageUser>({
      query: body => ({
        method: 'PATCH',
        body: body,
        url: `/manage/user/${body.id}/`,
      }),
      transformResponse: response => ManageUser.parse(response),
      invalidatesTags: ['UserList'],
    }),
    [Endpoints.deleteUser]: builder.mutation<any, IApiDeleteUserPost>({
      query: body => ({
        method: 'DELETE',
        body: body,
        url: `/delete/user/${body.id}/`,
      }),
      invalidatesTags: ['UserList'],
    }),
    [Endpoints.login]: builder.mutation<IApiLoginResponse, IApiLoginPost>({
      query: body => ({
        url: '/auth/token/obtain/',
        method: 'POST',
        body: body,
      }),
      transformResponse: (result: BaseQueryResult<any>) => {
        Server.defaults.headers.common.Authorization = `Bearer ${result.access}`
        return result
      },
    }),
    [Endpoints.refreshAccessToken]: builder.mutation<
      IApiRefreshResponse,
      IApiRefreshPost
    >({
      query: body => ({
        url: '/auth/token/refresh/',
        method: 'POST',
        body: body,
      }),
    }),

    [Endpoints.isFirstTimeSetup]: builder.query<boolean, void>({
      query: () => ({
        url: '/firsttimesetup/',
        method: 'GET',
      }),
      transformResponse: (response: any) => response.isFirstTimeSetup,
      providesTags: ['FirstTimeSetup'],
    }),
    [Endpoints.fetchPredefinedRules]: builder.query<any[], void>({
      query: () => '/predefinedrules/',
      transformResponse: (response: string) => JSON.parse(response),
    }),
    [Endpoints.fetchUserSelfDetails]: builder.query<IUser, string>({
      query: userId => `/user/${userId}/`,
      transformResponse: (response: string) => UserSchema.parse(response),
    }),
    [Endpoints.fetchUserList]: builder.query<IApiUserListResponse, void>({
      query: () => ({
        url: '/user/',
        method: 'GET',
      }),
      providesTags: ['UserList'],
    }),
    [Endpoints.uploadExists]: builder.query<boolean, string>({
      query: hash => `/exists/${hash}`,
      transformResponse: (response: string) =>
        UploadExistResponse.parse(response).exists,
    }),
    [Endpoints.uploadFinished]: builder.mutation<void, FormData>({
      query: form_data => ({
        url: '/upload/complete/',
        method: 'POST',
        body: form_data,
      }),
    }),
    [Endpoints.upload]: builder.mutation<IUploadResponse, IUploadOptions>({
      query: options => ({
        url: '/upload/',
        method: 'POST',
        body: options.form_data,
        headers: {
          'Content-Range': `bytes ${options.offset}-${
            options.offset + options.chunk_size - 1
          }/${options.chunk_size}`,
        },
      }),
      transformResponse: (response: IUploadResponse) =>
        UploadResponse.parse(response),
    }),
    [Endpoints.worker]: builder.query<IWorkerAvailabilityResponse, void>({
      query: () => ({
        url: '/rqavailable/',
        method: 'GET',
      }),
    }),
    [Endpoints.incompleteFaces]: builder.query<
      IIncompletePersonFaceListResponse,
      IIncompletePersonFaceListRequest
    >({
      query: ({ inferred = false }) => ({
        url: `faces/incomplete/?inferred=${inferred}`,
      }),
    }),
    [Endpoints.fetchFaces]: builder.query<
      IPersonFaceListResponse,
      IPersonFaceListRequest
    >({
      query: ({
        person,
        page = 0,
        inferred = false,
        orderBy = 'confidence',
      }) => ({
        url: `faces/?person=${person}&page=${page}&inferred=${inferred}&order_by=${orderBy}`,
      }),
    }),
    [Endpoints.clusterFaces]: builder.query<IClusterFacesResponse, void>({
      query: () => ({
        url: '/clusterfaces',
      }),
    }),
    [Endpoints.rescanFaces]: builder.query<IScanFacesResponse, void>({
      query: () => ({
        url: '/scanfaces',
      }),
    }),
    [Endpoints.trainFaces]: builder.mutation<ITrainFacesResponse, void>({
      query: () => ({
        url: '/trainfaces',
        method: 'POST',
      }),
    }),
    [Endpoints.deleteFaces]: builder.mutation<
      IDeleteFacesResponse,
      IDeleteFacesRequest
    >({
      query: ({ faceIds }) => ({
        url: '/deletefaces',
        method: 'POST',
        body: { face_ids: faceIds },
      }),
    }),
    [Endpoints.setFacesPersonLabel]: builder.mutation<
      ISetFacesLabelResponse,
      ISetFacesLabelRequest
    >({
      query: ({ faceIds, personName }) => ({
        url: '/labelfaces',
        method: 'POST',
        body: { person_name: personName, face_ids: faceIds },
      }),
    }),
  }),
})

export const {
  useLazyFetchUserListQuery,
  useLazyFetchPredefinedRulesQuery,
  useLazyFetchUserSelfDetailsQuery,
  useFetchUserListQuery,
  useFetchPredefinedRulesQuery,
  useFetchUserSelfDetailsQuery,
  useFetchIncompleteFacesQuery,
  useFetchFacesQuery,
  useSetFacesPersonLabelMutation,
  useDeleteFacesMutation,
  useRescanFacesQuery,
  useClusterFacesQuery,
  useLoginMutation,
  useSignUpMutation,
  useRefreshAccessTokenMutation,
  useWorkerQuery,
  useLazyWorkerQuery,
  useDeleteUserMutation,
  useManageUpdateUserMutation,
  useIsFirstTimeSetupQuery,
} = api
