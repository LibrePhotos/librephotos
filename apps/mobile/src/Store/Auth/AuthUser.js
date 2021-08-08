import { createAction } from '@reduxjs/toolkit'
import jwtDecode from 'jwt-decode'

export default {
  initialState: {
    access: {},
    refresh: {},
    isLoggedin: false,
  },
  action: createAction('auth/authUser'),
  reducers(state, { payload }) {
    if (typeof payload.access !== 'undefined') {
      state.access = {
        token: payload.access,
        ...jwtDecode(payload.access),
      }
    }
    if (typeof payload.refresh !== 'undefined') {
      state.refresh = {
        token: payload.refresh,
        ...jwtDecode(payload.refresh),
      }
    }
    if (typeof payload.isLoggedin !== 'undefined') {
      state.isLoggedin = payload.isLoggedin
    }
  },
}
