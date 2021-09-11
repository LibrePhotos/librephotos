import { createAction } from '@reduxjs/toolkit'

export default {
  initialState: {},
  action: createAction('settings/appsettings'),
  reducers(state, { payload }) {
    if (typeof payload.theme !== 'undefined') {
      state.theme = payload.theme
    }
  },
}
