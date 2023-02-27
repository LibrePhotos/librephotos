import { createSlice } from '@reduxjs/toolkit'
import jwtDecode from 'jwt-decode'
// eslint-disable-next-line import/no-cycle
import { api } from '../api'
import { AuthErrorSchema } from './auth.zod'
import type { IAuthState, IToken } from './auth.zod'

const initialState: IAuthState = {
  access: null,
  refresh: null,
  error: null,
}

const authSlice = createSlice({
  name: 'auth',
  initialState: initialState,
  reducers: {
    tokenReceived: (state, { payload }) => ({
      ...state,
      access: {
        ...jwtDecode<IToken>(payload.access),
        token: payload.access,
      },
    }),
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
      .addMatcher(api.endpoints.signUp.matchRejected, (state, { payload }) => ({
        access: null,
        refresh: null,
        error: AuthErrorSchema.parse(payload),
      }))
      .addMatcher(
        api.endpoints.refreshAccessToken.matchRejected,
        (state, { payload }) => ({
          access: null,
          refresh: null,
          error: AuthErrorSchema.parse(payload),
        }),
      )
      .addMatcher(
        api.endpoints.refreshAccessToken.matchFulfilled,
        (state, { payload }) => ({
          ...state,
          access: {
            ...jwtDecode<IToken>(payload.access),
            token: payload.access,
          },
        }),
      )
  },
})

export const { actions: authActions, reducer: authReducer } = authSlice
export const { logout, tokenReceived, clearError } = authActions
