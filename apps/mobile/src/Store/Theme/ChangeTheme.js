import { createAction } from '@reduxjs/toolkit'

export default {
  initialState: {},
  action: createAction('theme/changeTheme'),
  reducers(state, { payload }) {
    if (typeof payload.theme !== 'undefined') {
      state.theme = payload.theme
    }
    if (typeof payload.darkMode !== 'undefined') {
      state.darkMode = payload.darkMode
    }
  },
}
