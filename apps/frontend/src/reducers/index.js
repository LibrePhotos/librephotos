import { combineReducers } from "redux";
import { connectRouter } from "connected-react-router";
import { reducer as notificationsReducer } from "reapop";
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

const appReducer = (history) =>
  combineReducers({
    router: connectRouter(history),
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

export default (history) => {
  return appReducer(history);
};

export const isAuthenticated = (state) => fromAuth.isAuthenticated(state.auth);
export const accessToken = (state) => fromAuth.accessToken(state.auth);
export const isAccessTokenExpired = (state) =>
  fromAuth.isAccessTokenExpired(state.auth);
export const refreshToken = (state) => fromAuth.refreshToken(state.auth);
export const isRefreshTokenExpired = (state) =>
  fromAuth.isRefreshTokenExpired(state.auth);
export const authErrors = (state) => fromAuth.errors(state.auth);

export function withAuth(headers) {
  return (state) => {
    return {
      ...headers,
      Authorization: `Bearer ${accessToken(state)}`,
    };
  };
}
