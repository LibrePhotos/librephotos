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
import { getConfig } from '@/Config'

import api from '@/Services/index'

import auth from './Auth'
import album from './Album'
import config from './Config'
import photos from './Photos'
import gallerylist from './GalleryList'
import startup from './Startup'
import search from './Search'
import user from './User'
import theme from './Theme'

const reducers = combineReducers({
  auth,
  album,
  config,
  photos,
  gallerylist,
  startup,
  search,
  user,
  theme,
})

const persistConfig = {
  key: 'root',
  storage: AsyncStorage,
  whitelist: ['auth', 'config', 'theme'],
}

const persistedReducer = persistReducer(persistConfig, reducers)

const store = configureStore({
  reducer: persistedReducer,
  middleware: getDefaultMiddleware => {
    const middlewares = getDefaultMiddleware({
      serializableCheck: false,
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
    api.defaults.headers.common.Authorization =
      'Bearer ' + authState.access.token
  }

  api.defaults.baseURL = getConfig(store.getState().config.baseurl).API_URL
}

const persistor = persistStore(store)

export { store, persistor }
