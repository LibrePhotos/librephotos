import { configureStore } from "@reduxjs/toolkit";
import { useDispatch } from "react-redux";
import type { RootReducerShape } from "../reducers/rootReducer";
import { rootReducer } from "../reducers/rootReducer";
import storage from "redux-persist/es/storage";
import { createFilter } from "redux-persist-transform-filter";
import { FLUSH, REHYDRATE, PAUSE, PERSIST, PURGE, REGISTER, persistReducer, persistStore } from "redux-persist";
import appHistory from "../history";
import { routerMiddleware } from "connected-react-router";
import { userApi } from "./user/user.api";
import { setupListeners } from "@reduxjs/toolkit/query";
import autoMergeLevel1 from "redux-persist/es/stateReconciler/autoMergeLevel1";
import type { AnyAction } from "redux";

const persistedFilter = createFilter("auth", ["access", "refresh"]);

const reducer = persistReducer<RootReducerShape, AnyAction>(
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
