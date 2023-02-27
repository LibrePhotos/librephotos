import { createSlice } from '@reduxjs/toolkit'
import { FileLogger } from 'react-native-file-logger'
import { IConfigState } from './config.zod'

const initialState: IConfigState = {
  baseurl: 'http://192.168.0.107:3000',
  logging: true,
}

const configSlice = createSlice({
  name: 'config',
  initialState: initialState,
  reducers: {
    changeBaseurl: (state, { payload }) => {
      if (typeof payload.baseurl !== 'undefined') {
        state.baseurl = payload.baseurl
      }
    },
    configureLogging: (state, { payload }) => {
      if (typeof payload.logging !== 'undefined') {
        state.logging = payload.logging

        if (payload.logging === false) {
          FileLogger.debug('Logging: Enabled')
        } else {
          FileLogger.debug('Logging: Disabled')
          FileLogger.deleteLogFiles()
        }
      }
    },
  },
})

export const { reducer: configReducer, actions: configActions } = configSlice
export const { changeBaseurl, configureLogging } = configActions
