import { createAction } from '@reduxjs/toolkit'
import { FileLogger } from 'react-native-file-logger'

export default {
  initialState: { logging: true },
  action: createAction('config/configureLogging'),
  reducers(state, { payload }) {
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
}
