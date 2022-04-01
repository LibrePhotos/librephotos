import { combineReducers } from "@reduxjs/toolkit";
import { connectRouter } from "connected-react-router";
import people from "../reducers/peopleReducer";
import faces from "../reducers/facesReducer";
import albums from "../reducers/albumsReducer";
import util from "../reducers/utilReducer";
import photos from "../reducers/photosReducer";
import search from "../reducers/searchReducer";
import ui from "../reducers/uiReducer";
import pub from "../reducers/publicReducer";
import appHistory from "../history";
import { reducer as notificationsReducer } from "reapop";
import { userReducer as user } from "./user/userSlice";
import { authReducer as auth } from "./auth/authSlice";
import { api } from "../api_client/api";

export const rootReducer = combineReducers({
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
  [api.reducerPath]: api.reducer,
});
