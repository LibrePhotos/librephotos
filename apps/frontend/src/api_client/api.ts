import type { FetchBaseQueryError } from "@reduxjs/toolkit/query";
import type { BaseQueryFn, FetchArgs } from "@reduxjs/toolkit/query/react";
import { createApi, fetchBaseQuery } from "@reduxjs/toolkit/query/react";
import { Cookies } from "react-cookie";

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
  logout = "logout",
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
    [Endpoints.logout]: builder.mutation<void, void>({
      query: () => ({
        url: "/auth/token/blacklist/",
        method: "POST",
        body: { refresh: new Cookies().get("refresh") },
      }),
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
    [Endpoints.incompleteFaces]: builder.query<CompletePersonFaceList, IncompletePersonFaceListRequest>({
      query: ({ inferred = false, method = "clustering", orderBy = "confidence", minConfidence }) => ({
        url: `faces/incomplete/?inferred=${inferred}${inferred ? `&analysis_method=${method}&order_by=${orderBy}` : ""}${minConfidence ? `&min_confidence=${minConfidence}` : ""}`,
      }),
      transformResponse: response => {
        const payload = IncompletePersonFaceListResponse.parse(response);
        const newFacesList: CompletePersonFaceList = payload.map(person => {
          const completePersonFace: CompletePersonFace = { ...person, faces: [] };
          for (let i = 0; i < person.face_count; i += 1) {
            completePersonFace.faces.push({
              id: i,
              image: null,
              face_url: null,
              photo: "",
              person_label_probability: 1,
              person: person.id,
              isTemp: true,
            });
          }
          return completePersonFace;
        });
        return newFacesList;
      },
      providesTags: (result, error, { inferred, method, orderBy }) =>
        result ? result.map(({ id }) => ({ type: "Faces", id })) : ["Faces"],
    }),
    [Endpoints.fetchFaces]: builder.query<PersonFaceList, PersonFaceListRequest>({
      query: ({ person, page = 0, inferred = false, orderBy = "confidence", method, minConfidence }) => ({
        url: `faces/?person=${person}&page=${page}&inferred=${inferred}&order_by=${orderBy}${method ? `&analysis_method=${method}` : ""}${minConfidence ? `&min_confidence=${minConfidence}` : ""}`,
      }),
      transformResponse: (response: any) => {
        const parsedResponse = PersonFaceListResponse.parse(response);
        return parsedResponse.results;
      },
      async onQueryStarted(options, { dispatch, queryFulfilled }) {
        const { data } = await queryFulfilled;
        dispatch(
          api.util.updateQueryData(
            Endpoints.incompleteFaces,
            {
              method: options.method,
              orderBy: options.orderBy,
              inferred: options.inferred,
              minConfidence: options.minConfidence,
            },
            draft => {
              const indexToReplace = draft.findIndex(group => group.id === options.person);
              const groupToChange = draft[indexToReplace];
              if (!groupToChange) return;

              const { faces } = groupToChange;
              groupToChange.faces = faces
                .slice(0, (options.page - 1) * 100)
                .concat(data)
                .concat(faces.slice(options.page * 100));

              // eslint-disable-next-line no-param-reassign
              draft[indexToReplace] = groupToChange;
            }
          )
        );
      },
      providesTags: (result, error, { person }) => [{ type: "Faces", id: person }],
    }),
    [Endpoints.deleteFaces]: builder.mutation<DeleteFacesResponse, DeleteFacesRequest>({
      query: ({ faceIds }) => ({
        url: "/deletefaces",
        method: "POST",
        body: { face_ids: faceIds },
      }),
      transformResponse: response => {
        const payload = DeleteFacesResponse.parse(response);
        return payload;
      },
      async onQueryStarted({ faceIds }, { dispatch, queryFulfilled, getState }) {
        const { activeTab, analysisMethod, orderBy } = getState().face;
        const incompleteFacesArgs = { inferred: activeTab !== "labeled", method: analysisMethod, orderBy: orderBy };

        const patchIncompleteFaces = dispatch(
          api.util.updateQueryData(Endpoints.incompleteFaces, incompleteFacesArgs, draft => {
            draft.forEach(personGroup => {
              personGroup.faces = personGroup.faces.filter(face => !faceIds.includes(face.id));
            });
            draft.forEach(personGroup => {
              personGroup.face_count = personGroup.faces.length;
            });

            draft = draft.filter(personGroup => personGroup.faces.length > 0);
          })
        );

        try {
          await queryFulfilled;
        } catch {
          patchIncompleteFaces.undo();
        }
      },
    }),
    [Endpoints.setFacesPersonLabel]: builder.mutation<SetFacesLabelResponse, SetFacesLabelRequest>({
      query: ({ faceIds, personName }) => ({
        url: "/labelfaces",
        method: "POST",
        body: { person_name: personName, face_ids: faceIds },
      }),
      transformResponse: response => {
        const payload = SetFacesLabelResponse.parse(response);
        notification.addFacesToPerson(payload.results[0].person_name, payload.results.length);
        return payload;
      },
      // To-Do: Handle optimistic updates by updating the cache. The issue is that there are multiple caches that need to be updated, where we need to remove the faces from the incomplete faces cache and add them to the labeled faces cache.
      // This is surprisingly complex to do with the current API, so we will just invalidate the cache for now.
      // To-Do: Invalidating faces is also broken, because we do not know, which faces have which person ids, we need to invalidate.
      // Need to restructure, by providing the full face object when queried, so we can invalidate the cache properly.
      invalidatesTags: ["Faces", "PeopleAlbums"],
    }),

    [Endpoints.clusterFaces]: builder.query<ClusterFacesResponse, void>({
      query: () => ({
        url: "/clusterfaces",
      }),
    }),
    [Endpoints.rescanFaces]: builder.query<ScanFacesResponse, void>({
      query: () => ({
        url: "/scanfaces",
      }),
    }),
    [Endpoints.generateAutoAlbumTitle]: builder.query<IGenerateEventAlbumsTitlesResponse, void>({
      query: () => ({
        url: "/autoalbumtitlegen",
      }),
    }),
    [Endpoints.trainFaces]: builder.mutation<TrainFacesResponse, void>({
      query: () => ({
        url: "/trainfaces",
        method: "POST",
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
  useFetchUserSelfDetailsQuery,
  useFetchPredefinedRulesQuery,
  useFetchIncompleteFacesQuery,
  useFetchFacesQuery,
  useLoginMutation,
  useSignUpMutation,
  useLogoutMutation,
  useWorkerQuery,
  useDeleteUserMutation,
  useManageUpdateUserMutation,
  useIsFirstTimeSetupQuery,
  useFetchServerStatsQuery,
  useFetchStorageStatsQuery,
  useFetchImageTagQuery,
} = api;
