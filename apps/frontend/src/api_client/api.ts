import type { FetchBaseQueryError } from "@reduxjs/toolkit/query";
import type { BaseQueryFn, FetchArgs } from "@reduxjs/toolkit/query/react";
import { createApi, fetchBaseQuery } from "@reduxjs/toolkit/query/react";
import { Cookies } from "react-cookie";

import type { IGenerateEventAlbumsTitlesResponse } from "../actions/utilActions.types";
import type {
  IApiDeleteUserPost,
  IApiLoginPost,
  IApiLoginResponse,
  UserSignupRequest,
  UserSignupResponse,
} from "../store/auth/auth.zod";
import { ApiLoginResponseSchema, UserSignupResponseSchema } from "../store/auth/auth.zod";
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
} from "../store/faces/facesActions.types";
import type { IUploadOptions, IUploadResponse } from "../store/upload/upload.zod";
import { UploadExistResponse, UploadResponse } from "../store/upload/upload.zod";
import type { IManageUser, IUser, UserList } from "../store/user/user.zod";
import { ApiUserListResponseSchema, ManageUser, UserSchema } from "../store/user/user.zod";
import type { ImageTagResponseType, ServerStatsResponseType, StorageStatsResponseType } from "../store/util/util.zod";
import type { IWorkerAvailabilityResponse } from "../store/worker/worker.zod";

export enum Endpoints {
  login = "login",
  signUp = "signUp",
  fetchUserList = "fetchUserList",
  fetchUserSelfDetails = "fetchUserSelfDetails",
  fetchPredefinedRules = "fetchPredefinedRules",
  uploadExists = "uploadExists",
  uploadFinished = "uploadFinished",
  upload = "upload",
  worker = "worker",
  deleteUser = "deleteUser",
  manageUpdateUser = "manageUpdateUser",
  jobs = "jobs",
  incompleteFaces = "fetchIncompleteFaces",
  isFirstTimeSetup = "isFirstTimeSetup",
  fetchFaces = "fetchFaces",
  clusterFaces = "clusterFaces",
  rescanFaces = "rescanFaces",
  trainFaces = "trainFaces",
  deleteFaces = "deleteFaces",
  setFacesPersonLabel = "setFacesPersonLabel",
  fetchServerStats = "fetchServerStats",
  fetchStorageStats = "fetchStorageStats",
  fetchImageTag = "fetchImageTag",
  generateAutoAlbumTitle = "generateAutoAlbumTitle",
}

const baseQuery = fetchBaseQuery({
  baseUrl: "/api/",
  prepareHeaders: async (headers, { endpoint }) => {
    const cookies = new Cookies();
    const accessToken = cookies.get("access");
    if (accessToken && endpoint !== "refresh") {
      headers.set("Authorization", `Bearer ${accessToken}`);
    }
    return headers;
  },
  credentials: "include",
});

export const baseQueryWithReauth: BaseQueryFn<string | FetchArgs, unknown, FetchBaseQueryError> = async (
  args,
  api,
  extraOptions
) => {
  let result = await baseQuery(args, api, extraOptions);

  if (result.error && result.error.status === 401) {
    const cookies = new Cookies();
    // try to get a new token
    const refreshToken = cookies.get("refresh");
    if (refreshToken) {
      const refreshResult = (await baseQuery(
        { url: "/auth/token/refresh/", method: "POST", body: { refresh: refreshToken } },
        api,
        extraOptions
      )) as { data: { access: string } };
      if (refreshResult.data) {
        cookies.set("access", refreshResult.data.access);
        // retry the initial query
        result = await baseQuery(args, api, extraOptions);
      }
    }
  }
  return result;
};

export const api = createApi({
  reducerPath: "api",
  baseQuery: baseQueryWithReauth,
  tagTypes: ["UserList", "FirstTimeSetup", "Faces", "PeopleAlbums", "UserSelfDetails"],
  endpoints: builder => ({
    [Endpoints.signUp]: builder.mutation<UserSignupResponse, UserSignupRequest>({
      query: body => ({
        method: "POST",
        body,
        url: "/user/",
      }),
      transformResponse: response => UserSignupResponseSchema.parse(response),
      invalidatesTags: ["FirstTimeSetup", "UserList"],
    }),
    [Endpoints.manageUpdateUser]: builder.mutation<IManageUser, IManageUser>({
      query: body => ({
        method: "PATCH",
        body,
        url: `/manage/user/${body.id}/`,
      }),
      transformResponse: response => ManageUser.parse(response),
      invalidatesTags: ["UserList"],
    }),
    [Endpoints.deleteUser]: builder.mutation<any, IApiDeleteUserPost>({
      query: body => ({
        method: "DELETE",
        body,
        url: `/delete/user/${body.id}/`,
      }),
      invalidatesTags: ["UserList"],
    }),
    [Endpoints.login]: builder.mutation<IApiLoginResponse, IApiLoginPost>({
      query: body => ({
        url: "/auth/token/obtain/",
        method: "POST",
        body,
      }),
      transformResponse: (response: IApiLoginResponse) => {
        const data = ApiLoginResponseSchema.parse(response);
        const cookies = new Cookies();
        cookies.set("access", data.access);
        cookies.set("refresh", data.refresh);
        return data;
      },
    }),
    [Endpoints.isFirstTimeSetup]: builder.query<boolean, void>({
      query: () => ({
        url: "/firsttimesetup/",
        method: "GET",
      }),
      transformResponse: (response: any) => response.isFirstTimeSetup,
      providesTags: ["FirstTimeSetup"],
    }),
    [Endpoints.fetchPredefinedRules]: builder.query<any[], void>({
      query: () => "/predefinedrules/",
      transformResponse: (response: string) => JSON.parse(response),
    }),
    [Endpoints.fetchUserSelfDetails]: builder.query<IUser, string>({
      query: userId => `/user/${userId}/`,
      transformResponse: (response: string) => UserSchema.parse(response),
      providesTags: (result, error, id) => [{ type: "UserSelfDetails" as const, id }],
    }),
    [Endpoints.fetchUserList]: builder.query<UserList, void>({
      query: () => ({
        url: "/user/",
        method: "GET",
      }),
      transformResponse: (response: string) => ApiUserListResponseSchema.parse(response).results,
      providesTags: ["UserList"],
    }),
    [Endpoints.uploadExists]: builder.query<boolean, string>({
      query: hash => `/exists/${hash}`,
      transformResponse: (response: string) => UploadExistResponse.parse(response).exists,
    }),
    [Endpoints.uploadFinished]: builder.mutation<void, FormData>({
      query: form_data => ({
        url: "/upload/complete/",
        method: "POST",
        body: form_data,
      }),
    }),
    [Endpoints.upload]: builder.mutation<IUploadResponse, IUploadOptions>({
      query: options => ({
        url: "/upload/",
        method: "POST",
        body: options.form_data,
        headers: {
          "Content-Range": `bytes ${options.offset}-${options.offset + options.chunk_size - 1}/${options.chunk_size}`,
        },
      }),
      transformResponse: (response: IUploadResponse) => UploadResponse.parse(response),
    }),
    [Endpoints.worker]: builder.query<IWorkerAvailabilityResponse, void>({
      query: () => ({
        url: "/rqavailable/",
        method: "GET",
      }),
    }),
    [Endpoints.incompleteFaces]: builder.query<IIncompletePersonFaceListResponse, IIncompletePersonFaceListRequest>({
      query: ({ inferred = false }) => ({
        url: `faces/incomplete/?inferred=${inferred}`,
      }),
      providesTags: ["Faces"],
    }),
    [Endpoints.fetchFaces]: builder.query<IPersonFaceListResponse, IPersonFaceListRequest>({
      query: ({ person, page = 0, inferred = false, orderBy = "confidence" }) => ({
        url: `faces/?person=${person}&page=${page}&inferred=${inferred}&order_by=${orderBy}`,
      }),
      providesTags: ["Faces"],
    }),
    [Endpoints.clusterFaces]: builder.query<IClusterFacesResponse, void>({
      query: () => ({
        url: "/clusterfaces",
      }),
    }),
    [Endpoints.rescanFaces]: builder.query<IScanFacesResponse, void>({
      query: () => ({
        url: "/scanfaces",
      }),
    }),
    [Endpoints.generateAutoAlbumTitle]: builder.query<IGenerateEventAlbumsTitlesResponse, void>({
      query: () => ({
        url: "/autoalbumtitlegen",
      }),
    }),
    [Endpoints.trainFaces]: builder.mutation<ITrainFacesResponse, void>({
      query: () => ({
        url: "/trainfaces",
        method: "POST",
      }),
    }),
    [Endpoints.deleteFaces]: builder.mutation<IDeleteFacesResponse, IDeleteFacesRequest>({
      query: ({ faceIds }) => ({
        url: "/deletefaces",
        method: "POST",
        body: { face_ids: faceIds },
      }),
    }),
    [Endpoints.setFacesPersonLabel]: builder.mutation<ISetFacesLabelResponse, ISetFacesLabelRequest>({
      query: ({ faceIds, personName }) => ({
        url: "/labelfaces",
        method: "POST",
        body: { person_name: personName, face_ids: faceIds },
      }),
    }),
    [Endpoints.fetchServerStats]: builder.query<ServerStatsResponseType, void>({
      query: () => ({
        url: `serverstats`,
      }),
    }),
    [Endpoints.fetchStorageStats]: builder.query<StorageStatsResponseType, void>({
      query: () => ({
        url: `storagestats`,
      }),
    }),
    [Endpoints.fetchImageTag]: builder.query<ImageTagResponseType, void>({
      query: () => ({
        url: `imagetag`,
      }),
    }),
  }),
});

export const {
  useFetchUserListQuery,
  useFetchPredefinedRulesQuery,
  useFetchIncompleteFacesQuery,
  useLoginMutation,
  useSignUpMutation,
  useWorkerQuery,
  useDeleteUserMutation,
  useManageUpdateUserMutation,
  useIsFirstTimeSetupQuery,
  useFetchServerStatsQuery,
  useFetchStorageStatsQuery,
  useFetchImageTagQuery,
} = api;
