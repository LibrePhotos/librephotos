import { createAction } from '@reduxjs/toolkit'

export default {
  initialState: {},
  action: createAction('config/changeBaseUrl'),
  reducers(state, { payload }) {
    if (typeof payload.baseurl !== 'undefined') {
      state.baseurl = payload.baseurl
    }
  },
}
