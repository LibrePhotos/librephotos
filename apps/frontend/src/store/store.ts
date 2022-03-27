import { configureStore } from "@reduxjs/toolkit";

import { rootReducer } from "../reducers/rootReducer";
import storage from "redux-persist/es/storage";
import { createFilter } from "redux-persist-transform-filter";
import { FLUSH, PAUSE, PERSIST, persistReducer, persistStore, PURGE, REGISTER, REHYDRATE } from "redux-persist";
import appHistory from "../history";
import { routerMiddleware } from "connected-react-router";
import { userApi } from "./user/user.api";
import { setupListeners } from "@reduxjs/toolkit/query";
import autoMergeLevel1 from "redux-persist/es/stateReconciler/autoMergeLevel1";
import type { TypedUseSelectorHook } from "react-redux";
import { useDispatch, useSelector } from "react-redux";

const persistedFilter = createFilter("auth", ["access", "refresh"]);

const reducer = persistReducer<ReturnType<typeof rootReducer>>(
  {
    key: "polls",
    storage: storage,
    whitelist: ["auth"],
    transforms: [persistedFilter],
    stateReconciler: autoMergeLevel1,
  },
  rootReducer
);

export const store = configureStore({
  reducer: reducer,
  middleware: (getDefaultMiddleware) =>
    getDefaultMiddleware({
      immutableCheck: false,
      serializableCheck: {
        ignoredActions: [FLUSH, REHYDRATE, PAUSE, PERSIST, PURGE, REGISTER],
      },
    }).concat(routerMiddleware(appHistory), userApi.middleware),
});
persistStore(store);

setupListeners(store.dispatch);
export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;
export const useAppDispatch = () => useDispatch<AppDispatch>();
export const useAppSelector: TypedUseSelectorHook<RootState> = useSelector;
