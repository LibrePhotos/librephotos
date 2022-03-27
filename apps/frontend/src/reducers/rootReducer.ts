import type { AnyAction } from "@reduxjs/toolkit";
import { combineReducers } from "@reduxjs/toolkit";
import { connectRouter } from "connected-react-router";
import people from "./peopleReducer";
import faces from "./facesReducer";
import albums from "./albumsReducer";
import util from "./utilReducer";
import photos from "./photosReducer";
import auth from "./authReducer";
import search from "./searchReducer";
import ui from "./uiReducer";
import pub from "./publicReducer";
import appHistory from "./../history";
import { reducer as notificationsReducer } from "reapop";
import { userReducer as user } from "../store/user/userSlice";
import { userApi } from "../store/user/user.api";

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
  [userApi.reducerPath]: userApi.reducer,
});

export type RootReducerShape = ReturnType<typeof appReducer>;

export const rootReducer = (state: RootReducerShape | undefined, action: AnyAction) => {
  if (action.type === "LOGOUT") {
    state = undefined;
  }

  return appReducer(state, action);
};
