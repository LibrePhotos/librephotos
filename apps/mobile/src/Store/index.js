import AsyncStorage from '@react-native-async-storage/async-storage'
import { combineReducers } from 'redux'
import {
  persistReducer,
  persistStore,
  FLUSH,
  REHYDRATE,
  PAUSE,
  PERSIST,
  PURGE,
  REGISTER,
} from 'redux-persist'
import thunk from 'redux-thunk'
import { configureStore } from '@reduxjs/toolkit'
import axios from 'axios'

import auth from './Auth'
import album from './Album'
import photos from './Photos'
import startup from './Startup'
import user from './User'
import theme from './Theme'

const reducers = combineReducers({
  auth,
  album,
  photos,
  startup,
  user,
  theme,
})

const persistConfig = {
  key: 'root',
  storage: AsyncStorage,
  whitelist: ['auth', 'theme'],
}

const persistedReducer = persistReducer(persistConfig, reducers)

const store = configureStore({
  reducer: persistedReducer,
  middleware: getDefaultMiddleware => {
    const middlewares = getDefaultMiddleware({
      serializableCheck: {
        ignoredActions: [FLUSH, REHYDRATE, PAUSE, PERSIST, PURGE, REGISTER],
      },
    })

    middlewares.push(thunk)

    if (__DEV__ && !process.env.JEST_WORKER_ID) {
      const createDebugger = require('redux-flipper').default
      middlewares.push(createDebugger())
      console.log('Debugging..')
    }

    return middlewares
  },
})

store.subscribe(listener)

function select(state) {
  return state.auth
}

function listener() {
  var authState = select(store.getState())
  if (authState.access) {
    axios.defaults.headers.common.Authorization =
      'Bearer ' + authState.access.token
  }
}

const persistor = persistStore(store)

export { store, persistor }
