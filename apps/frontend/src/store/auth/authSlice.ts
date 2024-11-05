import { createSlice } from "@reduxjs/toolkit";
import jwtDecode from "jwt-decode";
import { Cookies } from "react-cookie";
import { push } from "redux-first-history";

// eslint-disable-next-line import/no-cycle
import { api } from "../../api_client/api";
import { AuthErrorSchema } from "./auth.zod";
import type { IAuthState, IToken } from "./auth.zod";

const cookies = new Cookies();

const initialState: IAuthState = {
  access: cookies.get("access") ? { ...jwtDecode<IToken>(cookies.get("access")), token: cookies.get("access") } : null,
  refresh: cookies.get("refresh")
    ? {
        ...jwtDecode<IToken>(cookies.get("refresh")),
        token: cookies.get("refresh"),
      }
    : null,
  error: null,
};

const authSlice = createSlice({
  name: "auth",
  initialState,
  reducers: {
    tokenReceived: (state, { payload }) => ({
      ...state,
      access: {
        ...jwtDecode<IToken>(payload.access),
        token: payload.access,
      },
    }),
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
      .addMatcher(api.endpoints.signUp.matchRejected, (state, { payload }) => ({
        access: null,
        refresh: null,
        error: AuthErrorSchema.parse(payload),
      }))
      .addMatcher(api.endpoints.logout.matchFulfilled, state => {
        cookies.remove("access");
        cookies.remove("refresh");
        push("/login");
        return { access: null, refresh: null, error: null };
      });
  },
});

export const authReducer = authSlice.reducer;

export const { actions: authActions } = authSlice;
export const { tokenReceived, clearError } = authActions;
