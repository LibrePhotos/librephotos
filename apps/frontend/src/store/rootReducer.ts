import { combineReducers } from "@reduxjs/toolkit";
import { connectRouter } from "connected-react-router";

import { api } from "../api_client/api";
import appHistory from "../history";
import albums from "../reducers/albumsReducer";
import faces from "../reducers/facesReducer";
import people from "../reducers/peopleReducer";
import photos from "../reducers/photosReducer";
import pub from "../reducers/publicReducer";
import search from "../reducers/searchReducer";
import ui from "../reducers/uiReducer";
import util from "../reducers/utilReducer";
import { authReducer as auth } from "./auth/authSlice";
import { userReducer as user } from "./user/userSlice";

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
  [api.reducerPath]: api.reducer,
});
