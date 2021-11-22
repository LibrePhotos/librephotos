import { applyMiddleware, createStore, compose } from "redux";
import thunk from "redux-thunk";
import storage from "redux-persist/es/storage";
import { createFilter } from "redux-persist-transform-filter";
import { persistReducer, persistStore } from "redux-persist";
import rootReducer from "./reducers";
import appHistory from "./history";
import { routerMiddleware } from "connected-react-router";

declare global {
  interface Window {
    __REDUX_DEVTOOLS_EXTENSION_COMPOSE__?: typeof compose;
  }
}
const composeEnhancers = window.__REDUX_DEVTOOLS_EXTENSION_COMPOSE__ || compose;

const configureStore = () => {
  const persistedFilter = createFilter("auth", ["access", "refresh"]);

  const reducer = persistReducer(
    {
      key: "polls",
      storage: storage,
      whitelist: ["auth"],
      transforms: [persistedFilter],
    },
    rootReducer
  );

  const store = createStore(
    reducer,
    {},
    composeEnhancers(applyMiddleware(thunk, routerMiddleware(appHistory)))
  );

  persistStore(store);

  return store;
};

const store = configureStore()
export type RootState = ReturnType<typeof store.getState>
export type AppDispatch = typeof store.dispatch
export default store;
