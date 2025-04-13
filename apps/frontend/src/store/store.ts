import { configureStore } from "@reduxjs/toolkit";
import { setupListeners } from "@reduxjs/toolkit/query";
import { createBrowserHistory } from "history";
import type { TypedUseSelectorHook } from "react-redux";
import { useDispatch, useSelector } from "react-redux";
import { combineReducers } from "redux";
import { createReduxHistoryContext } from "redux-first-history";
import { FLUSH, PAUSE, PERSIST, PURGE, REGISTER, REHYDRATE, persistStore } from "redux-persist";

import albums from "../reducers/albumsReducer";
import { photos } from "../reducers/photosReducer";
import { search } from "../reducers/searchReducer";
import ui from "../reducers/uiReducer";
import util from "../reducers/utilReducer";
import { playerReducer as player } from "./player/playerSlice";

const { createReduxHistory, routerMiddleware, routerReducer } = createReduxHistoryContext({
  history: createBrowserHistory(),
  reduxTravelling: true,
  showHistoryAction: true,
  savePreviousLocations: 100,
});

export const store = configureStore({
  reducer: combineReducers({
    router: routerReducer,
    albums,
    util,
    photos,
    search,
    ui,
    player,
  }),
  middleware: getDefaultMiddleware =>
    getDefaultMiddleware({
      immutableCheck: false,
      serializableCheck: {
        ignoredActions: [FLUSH, REHYDRATE, PAUSE, PERSIST, PURGE, REGISTER, 
          // Ignore RTK Query prefetch/fulfilled actions for server logs
          'api/fetchServerLogs/executeQuery',
          'api/fetchServerLogs/fulfilled',
          'api/internal/executeQuery'
        ],
        // Ignore paths that might contain non-serializable values
        ignoredPaths: [
          'api.queries.fetchServerLogs',
          'api.mutations.fetchServerLogs',
        ],
      },
    }).concat(routerMiddleware),
});

export const libreHistory = createReduxHistory(store);
persistStore(store);
setupListeners(store.dispatch);

export const selectSelf = (state: RootState): RootState => state;
export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;
export const useAppDispatch = () => useDispatch<AppDispatch>();
export const useAppSelector: TypedUseSelectorHook<RootState> = useSelector;
