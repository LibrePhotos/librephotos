import { createApi, fetchBaseQuery } from "@reduxjs/toolkit/query/react";
import type { IUser } from "./user.zod";
import { REHYDRATE } from "redux-persist";
import type { RootState } from "../store";
import { UserSchema } from "./user.zod";

export const userApi = createApi({
  reducerPath: "userApi",

  baseQuery: fetchBaseQuery({
    baseUrl: "/api/",
    headers: {
      "Content-Type": "application/json",
    },
    credentials: "include",

    prepareHeaders: (headers, { getState, endpoint }) => {
      headers.set("xsrfHeaderName", "X-CSRFToken");
      headers.set("xsrfCookieName", "csrftoken");

      const user = (getState() as RootState).user;
      const token = (getState() as RootState).auth.access.token;
      if (user && token && endpoint !== "refresh") {
        headers.set("Authorization", `Bearer ${token}`);
      }
      return headers;
    },
  }),
  extractRehydrationInfo: (action, { reducerPath }) => {
    if (action.type === REHYDRATE) {
      return action.payload[reducerPath];
    }
  },
  endpoints: (builder) => ({
    //TODO Add Types and ZOD
    fetchPredefinedRules: builder.query<any[], void>({
      query: () => "/predefinedrules/",
      transformResponse: (response: string) => JSON.parse(response),
    }),
    //TODO Add Types and ZOD
    fetchUserSelfDetails: builder.query<IUser, string>({
      query: (userId) => `/user/${userId}/`,
      transformResponse: (response: string) => UserSchema.parse(response),
    }),
  }),
});

export const { useFetchPredefinedRulesQuery, useFetchUserSelfDetailsQuery } = userApi;
