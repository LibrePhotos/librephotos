import { createAction } from '@reduxjs/toolkit'

export default {
  initialState: {},
  action: createAction('auth/defaultUser'),
  reducers(state, { payload }) {
    if (typeof payload.refreshToken !== 'undefined') {
      state.refreshToken = payload.refreshToken
    }
  },
}
