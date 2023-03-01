import { configureStore } from '@reduxjs/toolkit'
import { setupListeners } from '@reduxjs/toolkit/query'
import type { TypedUseSelectorHook } from 'react-redux'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { useDispatch, useSelector } from 'react-redux'
import { combineReducers } from 'redux'
import {
  FLUSH,
  PAUSE,
  PERSIST,
  PURGE,
  REGISTER,
  REHYDRATE,
  persistStore,
  persistReducer,
} from 'redux-persist'

import thunk from 'redux-thunk'
import { api } from './api'
import { authReducer as auth } from './Auth/authSlice'
import { faceReducer as face } from './Faces/faceSlice'
import { configReducer as config } from './Config/configSlice'
import { errorMiddleware } from './middleware/errorMiddleware'
import { userReducer as user } from './User/userSlice'
import { worker } from './Worker/workerSlice'

import album from './Album'
import photos from './Photos'
import gallerylist from './GalleryList'
import startup from './Startup'
import search from './Search'
import theme from './Theme'

const reducers = combineReducers({
  face,
  auth,
  user,
  config,
  worker,
  album,
  photos,
  gallerylist,
  startup,
  search,
  theme,
  [api.reducerPath]: api.reducer,
})

const persistConfig = {
  key: 'root',
  storage: AsyncStorage,
  whitelist: ['auth', 'config', 'theme'],
}

const persistedReducer = persistReducer(persistConfig, reducers)
export const store = configureStore({
  reducer: persistedReducer,
  middleware: getDefaultMiddleware => {
    const middlewares = getDefaultMiddleware({
      immutableCheck: false,
      serializableCheck: {
        ignoredActions: [FLUSH, REHYDRATE, PAUSE, PERSIST, PURGE, REGISTER],
      },
    }).concat(api.middleware, errorMiddleware)

    middlewares.push(thunk)
    // @ts-ignore
    if (__DEV__ && !process.env.JEST_WORKER_ID) {
      const createDebugger = require('redux-flipper').default
      middlewares.push(createDebugger())
      console.log('Debugging..')
    }

    return middlewares
  },
})

setupListeners(store.dispatch)
export const persistor = persistStore(store)

export const selectSelf = (state: RootState): RootState => state
export type RootState = ReturnType<typeof store.getState>
export type AppDispatch = typeof store.dispatch
export const useAppDispatch = () => useDispatch<AppDispatch>()
export const useAppSelector: TypedUseSelectorHook<RootState> = useSelector
