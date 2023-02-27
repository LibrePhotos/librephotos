import { createSelector } from '@reduxjs/toolkit'

import type { RootState } from '../store'
import { selectSelf } from '../store'
import { isTokenExpired } from '../util/auth'

export const selectIsAuthenticated = createSelector(
  selectSelf,
  (state: RootState) =>
    state.auth.refresh !== null && state.auth.refresh.exp
      ? !isTokenExpired(state.auth.refresh.exp)
      : false,
)
export const accessToken = createSelector(
  selectSelf,
  (state: RootState) => state.auth.access,
)
export const isAccessTokenExpired = createSelector(
  selectSelf,
  (state: RootState) =>
    state.auth.access !== null ? isTokenExpired(state.auth.access.exp) : true,
)
export const refreshToken = createSelector(
  selectSelf,
  (state: RootState) => state.auth.refresh,
)
export const isRefreshTokenExpired = createSelector(
  selectSelf,
  (state: RootState) =>
    state.auth.refresh !== null && state.auth?.refresh?.exp
      ? isTokenExpired(state.auth.refresh.exp)
      : true,
)
export const selectAuthErrors = createSelector(
  selectSelf,
  (state: RootState) => state.auth.error ?? null,
)
export const selectAuth = createSelector(
  selectSelf,
  (state: RootState) => state.auth,
)
export const selectAuthAccess = createSelector(
  selectSelf,
  (state: RootState) => state.auth.access,
)
