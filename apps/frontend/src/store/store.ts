import { configureStore } from "@reduxjs/toolkit";
import { setupListeners } from "@reduxjs/toolkit/query";
import { createBrowserHistory } from "history";
import type { TypedUseSelectorHook } from "react-redux";
import { useDispatch, useSelector } from "react-redux";
import { combineReducers } from "redux";
import { createReduxHistoryContext } from "redux-first-history";
import { FLUSH, PAUSE, PERSIST, PURGE, REGISTER, REHYDRATE, persistStore } from "redux-persist";

import { api } from "../api_client/api";
import albums from "../reducers/albumsReducer";
import faces from "../reducers/facesReducer";
import people from "../reducers/peopleReducer";
import photos from "../reducers/photosReducer";
import pub from "../reducers/publicReducer";
import search from "../reducers/searchReducer";
import ui from "../reducers/uiReducer";
import util from "../reducers/utilReducer";
import { authReducer as auth } from "./auth/authSlice";
import { faceReducer as face } from "./faces/faceSlice";
import { errorMiddleware } from "./middleware/errorMiddleware";
import { userReducer as user } from "./user/userSlice";
import { worker } from "./worker/workerSlice";

const { createReduxHistory, routerMiddleware, routerReducer } = createReduxHistoryContext({
  history: createBrowserHistory(),
  reduxTravelling: true,
  showHistoryAction: true,
  savePreviousLocations: 100,
});

export const store = configureStore({
  reducer: combineReducers({
    router: routerReducer,
    people,
    face,
    albums,
    util,
    photos,
    auth,
    search,
    ui,
    pub,
    user,
    worker,
    [api.reducerPath]: api.reducer,
  }),
  middleware: getDefaultMiddleware =>
    getDefaultMiddleware({
      immutableCheck: false,
      serializableCheck: {
        ignoredActions: [FLUSH, REHYDRATE, PAUSE, PERSIST, PURGE, REGISTER],
      },
    }).concat(routerMiddleware, api.middleware, errorMiddleware),
});

export const libreHistory = createReduxHistory(store);
persistStore(store);
setupListeners(store.dispatch);

export const selectSelf = (state: RootState): RootState => state;
export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;
export const useAppDispatch = () => useDispatch<AppDispatch>();
export const useAppSelector: TypedUseSelectorHook<RootState> = useSelector;
