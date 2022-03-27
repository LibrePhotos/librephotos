import type { RootState } from "../store";
import * as fromAuth from "../../reducers/authReducer";

export const isAuthenticated = (state: RootState): boolean => fromAuth.isAuthenticated(state.auth);
export const accessToken = (state: RootState): string => fromAuth.accessToken(state.auth);
export const isAccessTokenExpired = (state: RootState): boolean => fromAuth.isAccessTokenExpired(state.auth);
export const refreshToken = (state: RootState): string => fromAuth.refreshToken(state.auth);
export const isRefreshTokenExpired = (state: RootState): boolean => fromAuth.isRefreshTokenExpired(state.auth);
export const authErrors = (state: RootState): Record<string, any> => fromAuth.errors(state.auth);
