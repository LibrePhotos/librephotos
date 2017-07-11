
import { applyMiddleware, createStore } from "redux"

import logger from "redux-logger"
import * as thunk from 'redux-thunk';
import promise from "redux-promise-middleware"

import reducer from "./reducers"

// const middleware = applyMiddleware(promise(), thunk, logger())

export default createStore(reducer, applyMiddleware(promise(),thunk.default))