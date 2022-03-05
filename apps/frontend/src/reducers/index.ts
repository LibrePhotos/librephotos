import { combineReducers } from "redux";
import type { AnyAction } from "redux";
import { connectRouter } from "connected-react-router";
import people from "./peopleReducer";
import faces from "./facesReducer";
import albums from "./albumsReducer";
import util from "./utilReducer";
import photos from "./photosReducer";
import auth, * as fromAuth from "./authReducer";
import search from "./searchReducer";
import ui from "./uiReducer";
import pub from "./publicReducer";
import user from "./userReducer";
import type { RootState } from "../store";
import appHistory from "./../history";
import { reducer as notificationsReducer } from "reapop";

const appReducer = combineReducers({
  router: connectRouter(appHistory),
  people,
  faces,
  albums,
  util,
  photos,
  auth,
  search,
  ui,
  pub,
  user,
  notifications: notificationsReducer(),
});

export default (state: ReturnType<typeof appReducer> | undefined, action: AnyAction) => {
  if (action.type === "LOGOUT") {
    state = undefined;
  }

  return appReducer(state, action);
};

export const isAuthenticated = (state: RootState) => fromAuth.isAuthenticated(state.auth);
export const accessToken = (state: RootState) => fromAuth.accessToken(state.auth);
export const isAccessTokenExpired = (state: RootState) => fromAuth.isAccessTokenExpired(state.auth);
export const refreshToken = (state: RootState) => fromAuth.refreshToken(state.auth);
export const isRefreshTokenExpired = (state: RootState) => fromAuth.isRefreshTokenExpired(state.auth);
export const authErrors = (state: RootState) => fromAuth.errors(state.auth);
