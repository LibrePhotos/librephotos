import type { FetchBaseQueryError } from "@reduxjs/toolkit/query";
import type { BaseQueryFn, FetchArgs } from "@reduxjs/toolkit/query/react";
import { createApi, fetchBaseQuery } from "@reduxjs/toolkit/query/react";
import { Cookies } from "react-cookie";

import type { IJobRequestSchema, IJobsResponseSchema } from "../actions/utilActions.types";
import type { IApiLoginPost, IApiLoginResponse, IApiUserSignUpPost } from "../store/auth/auth.zod";
// eslint-disable-next-line import/no-cycle
import { tokenReceived } from "../store/auth/authSlice";
import type { RootState } from "../store/store";
import type { IUploadOptions, IUploadResponse } from "../store/upload/upload.zod";
import { UploadExistResponse, UploadResponse } from "../store/upload/upload.zod";
import type { IApiUserListResponse, IUser } from "../store/user/user.zod";
import { UserSchema } from "../store/user/user.zod";
import type { IJobDetailSchema, IWorkerAvailabilityResponse } from "../store/worker/worker.zod";

export enum Endpoints {
  login = "login",
  signUp = "signUp",
  fetchUserList = "fetchUserList",
  fetchUserSelfDetails = "fetchUserSelfDetails",
  fetchPredefinedRules = "fetchPredefinedRules",
  refreshAccessToken = "refreshAccessToken",
  uploadExists = "uploadExists",
  uploadFinished = "uploadFinished",
  upload = "upload",
  worker = "worker",
  jobs = "jobs",
}

const baseQuery = fetchBaseQuery({
  baseUrl: "/api/",
  headers: {
    "Content-Type": "application/json",
  },
  credentials: "include",

  prepareHeaders: (headers, { getState, endpoint }) => {
    const cookies = new Cookies();
    headers.set("X-CSRFToken", cookies.get("csrftoken"));
    const { user } = getState() as RootState;
    const { access } = (getState() as RootState).auth;
    if (access !== null && user && endpoint !== "refresh") {
      headers.set("Authorization", `Bearer ${access.token}`);
    }
    return headers;
  },
});

const baseQueryWithReauth: BaseQueryFn<string | FetchArgs, unknown, FetchBaseQueryError> = async (
  args,
  api,
  extraOptions
) => {
  let result = await baseQuery(args, api, extraOptions);

  if (result.error && result.error.status === 401) {
    // try to get a new token
    const refreshToken: string = (api.getState() as RootState).auth?.refresh?.token;
    if (refreshToken) {
      const refreshResult = await baseQuery(
        { url: "/auth/token/refresh/", method: "POST", body: { refresh: refreshToken } },
        api,
        extraOptions
      );
      if (refreshResult.data) {
        // store the new token
        api.dispatch(tokenReceived(refreshResult.data));
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
  endpoints: builder => ({
    [Endpoints.signUp]: builder.mutation<IUser, IApiUserSignUpPost>({
      query: body => ({
        method: "POST",
        body: body,
        url: "/user/",
      }),
      transformResponse: response => UserSchema.parse(response),
    }),
    [Endpoints.login]: builder.mutation<IApiLoginResponse, IApiLoginPost>({
      query: body => ({
        url: "/auth/token/obtain/",
        method: "POST",
        body: body,
      }),
    }),
    [Endpoints.fetchPredefinedRules]: builder.query<any[], void>({
      query: () => "/predefinedrules/",
      transformResponse: (response: string) => JSON.parse(response),
    }),
    [Endpoints.fetchUserSelfDetails]: builder.query<IUser, string>({
      query: userId => `/user/${userId}/`,
      transformResponse: (response: string) => UserSchema.parse(response),
    }),
    [Endpoints.fetchUserList]: builder.query<IApiUserListResponse, void>({
      query: () => ({
        url: "/user/",
        method: "GET",
      }),
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
    [Endpoints.worker]: builder.query<IWorkerAvailabilityResponse, IJobDetailSchema>({
      query: () => ({
        url: "/rqavailable/",
        method: "GET",
      }),
    }),
    [Endpoints.jobs]: builder.query<IJobsResponseSchema, IJobRequestSchema>({
      query: ({ pageSize = 10, page = 0 }) => ({
        url: `jobs/?page_size=${pageSize}&page=${page}`,
      }),
    }),
  }),
});

export const {
  useLazyFetchUserListQuery,
  useLazyFetchPredefinedRulesQuery,
  useLazyFetchUserSelfDetailsQuery,
  useFetchUserListQuery,
  useFetchPredefinedRulesQuery,
  useFetchUserSelfDetailsQuery,
  useLoginMutation,
  useSignUpMutation,
  useWorkerQuery,
  useLazyWorkerQuery,
  useJobsQuery,
  useLazyJobsQuery,
} = api;
