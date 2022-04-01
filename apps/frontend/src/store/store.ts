import { configureStore } from "@reduxjs/toolkit";
import { rootReducer } from "./rootReducer";
import { FLUSH, PAUSE, PERSIST, persistStore, PURGE, REGISTER, REHYDRATE } from "redux-persist";
import appHistory from "../history";
import { routerMiddleware } from "connected-react-router";
import { setupListeners } from "@reduxjs/toolkit/query";
import type { TypedUseSelectorHook } from "react-redux";
import { useDispatch, useSelector } from "react-redux";
import { api } from "../api_client/api";
import { errorMiddleware } from "./middleware/errorMiddleware";

export const store = configureStore({
  reducer: rootReducer,
  middleware: getDefaultMiddleware =>
    getDefaultMiddleware({
      immutableCheck: false,
      serializableCheck: {
        ignoredActions: [FLUSH, REHYDRATE, PAUSE, PERSIST, PURGE, REGISTER],
      },
    }).concat(routerMiddleware(appHistory), api.middleware, errorMiddleware),
});
persistStore(store);

setupListeners(store.dispatch);
export const selectSelf = (state: RootState): RootState => state;
export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;
export const useAppDispatch = () => useDispatch<AppDispatch>();
export const useAppSelector: TypedUseSelectorHook<RootState> = useSelector;
