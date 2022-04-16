import { createSlice } from "@reduxjs/toolkit";
import jwtDecode from "jwt-decode";
import { persistReducer } from "redux-persist";
import { createFilter } from "redux-persist-transform-filter";
import storage from "redux-persist/es/storage";

import { api } from "../../api_client/api";
import { AuthErrorSchema } from "./auth.zod";
import type { IAuthState, IToken } from "./auth.zod";

const initialState: IAuthState = {
  access: null,
  refresh: null,
  error: null,
};

const authSlice = createSlice({
  name: "auth",
  initialState: initialState,
  reducers: {
    logout: () => initialState,
    clearError: state => ({ ...state, error: null }),
  },
  extraReducers: builder => {
    builder
      .addMatcher(api.endpoints.login.matchFulfilled, (state, { payload }) => ({
        ...state,
        access: {
          ...jwtDecode<IToken>(payload.access),
          token: payload.access,
        },
        refresh: {
          ...jwtDecode<IToken>(payload.refresh),
          token: payload.refresh,
        },
      }))
      .addMatcher(api.endpoints.login.matchRejected, (state, { payload }) => ({
        access: null,
        refresh: null,
        error: AuthErrorSchema.parse(payload),
      }))
      .addMatcher(api.endpoints.signUp.matchRejected, (state, { payload }) => {
        console.info("api.endpoints.signUp.matchRejected.payload: ", payload);

        return {
          access: null,
          refresh: null,
          error: AuthErrorSchema.parse(payload),
        };
      })
      .addMatcher(api.endpoints.refreshAccessToken.matchFulfilled, (state, { payload }) => ({
        ...state,
        access: payload,
        error: null,
      }))
      .addMatcher(api.endpoints.refreshAccessToken.matchRejected, (state, { payload }) => ({
        access: null,
        refresh: null,
        error: AuthErrorSchema.parse(payload),
      }));
  },
});

const persistedAccessToken = createFilter("access");
const persistedRefreshToken = createFilter("refresh");
export const authReducer = persistReducer(
  {
    key: "polls",
    storage,
    transforms: [persistedAccessToken, persistedRefreshToken],
    whitelist: ["access", "refresh"],
  },
  authSlice.reducer
);

export const { actions: authActions } = authSlice;
export const { logout } = authActions;
