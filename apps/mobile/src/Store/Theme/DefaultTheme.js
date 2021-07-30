import { createAction } from '@reduxjs/toolkit'

export default {
  initialState: {},
  action: createAction('theme/setDefaultTheme'),
  reducers(state, { payload }) {
    if (!state.theme) {
      state.theme = payload.theme
      state.darkMode = payload.darkMode
    }
  },
}
