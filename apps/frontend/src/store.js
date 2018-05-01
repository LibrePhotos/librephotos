import { applyMiddleware, createStore } from 'redux';
import promise from "redux-promise-middleware";
import thunk from "redux-thunk"
import { createLogger } from "redux-logger";

import reducer from "./reducers";
import history from './history'
import { ConnectedRouter, routerReducer, routerMiddleware, push } from 'react-router-redux'

const middleware = applyMiddleware(  thunk,  createLogger(), routerMiddleware(history) );
export default createStore(reducer, middleware);