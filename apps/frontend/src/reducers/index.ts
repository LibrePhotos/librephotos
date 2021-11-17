import { combineReducers } from "redux";
import { connectRouter } from "connected-react-router";
const reapop = require("reapop");
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
import { History } from "history";
import { RootState } from "../store";

const appReducer = (history: History) =>
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
    notifications: reapop.reducer(),
  });

export default (history: History) => {
  return appReducer(history);
};

export const isAuthenticated = (state: RootState) => fromAuth.isAuthenticated(state.auth);
export const accessToken = (state: RootState) => fromAuth.accessToken(state.auth);
export const isAccessTokenExpired = (state: RootState) =>
  fromAuth.isAccessTokenExpired(state.auth);
export const refreshToken = (state: RootState) => fromAuth.refreshToken(state.auth);
export const isRefreshTokenExpired = (state: RootState) =>
  fromAuth.isRefreshTokenExpired(state.auth);
export const authErrors = (state: RootState) => fromAuth.errors(state.auth);
