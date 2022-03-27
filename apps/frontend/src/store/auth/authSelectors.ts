import { RootState } from "../store";
import * as fromAuth from "../../reducers/authReducer";

export const isAuthenticated = (state: RootState) => fromAuth.isAuthenticated(state.auth);
export const accessToken = (state: RootState) => fromAuth.accessToken(state.auth);
export const isAccessTokenExpired = (state: RootState) => fromAuth.isAccessTokenExpired(state.auth);
export const refreshToken = (state: RootState) => fromAuth.refreshToken(state.auth);
export const isRefreshTokenExpired = (state: RootState) => fromAuth.isRefreshTokenExpired(state.auth);
export const authErrors = (state: RootState) => fromAuth.errors(state.auth);
