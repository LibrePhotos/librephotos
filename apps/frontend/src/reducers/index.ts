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
import appHistory from "./../history";
import { AnyAction } from "redux";

const appReducer =
  combineReducers({
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
    notifications: reapop.reducer(),
  });
  
export default (state: ReturnType<typeof appReducer> | undefined, action: AnyAction) => {
  /* if you are using RTK, you can import your action and use it's type property instead of the literal definition of the action  */
    if (action.type === "LOGOUT") {
      return appReducer(undefined, { type: undefined });
    }
  
    return appReducer(state, action);
  };

export const isAuthenticated = (state: RootState) => fromAuth.isAuthenticated(state.auth);
export const accessToken = (state: RootState) => fromAuth.accessToken(state.auth);
export const isAccessTokenExpired = (state: RootState) =>
  fromAuth.isAccessTokenExpired(state.auth);
export const refreshToken = (state: RootState) => fromAuth.refreshToken(state.auth);
export const isRefreshTokenExpired = (state: RootState) =>
  fromAuth.isRefreshTokenExpired(state.auth);
export const authErrors = (state: RootState) => fromAuth.errors(state.auth);
