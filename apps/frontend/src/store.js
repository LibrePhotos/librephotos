import { applyMiddleware, createStore } from 'redux';
import promise from "redux-promise-middleware";
import thunk from "redux-thunk"
import { createLogger } from "redux-logger";
import storage from 'redux-persist/es/storage'
// import { apiMiddleware } from 'redux-api-middleware';
import { createFilter   } from 'redux-persist-transform-filter';
import { persistReducer, persistStore } from 'redux-persist'
import rootReducer from "./reducers";
import history from './history'
import { ConnectedRouter, routerReducer, routerMiddleware, push } from 'react-router-redux'
import apiMiddleware from './middleware';

//const middleware = applyMiddleware(  thunk,  createLogger(), apiMiddleware, routerMiddleware(history) );
//export default createStore(reducer, middleware);




const configureStore = (history) => {
    const persistedFilter = createFilter(
        'auth', ['access', 'refresh']);

    const reducer = persistReducer(
        {
            key: 'polls',
            storage: storage,
            whitelist: ['auth'],
            transforms: [persistedFilter]
        },
        rootReducer)

    const store = createStore(
        reducer, {},
        applyMiddleware(  
            thunk,  
            // createLogger(), 
            // apiMiddleware, 
            routerMiddleware(history) )
    )

    persistStore(store)

    return store
}

export default configureStore(history)
