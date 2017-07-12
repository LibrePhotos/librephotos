import { applyMiddleware, createStore } from 'redux';
import promise from "redux-promise-middleware";
import thunk from "redux-thunk"
import { createLogger } from "redux-logger";

import reducer from "./reducers";
const middleware = applyMiddleware(  thunk,  createLogger() );
export default createStore(reducer, middleware);