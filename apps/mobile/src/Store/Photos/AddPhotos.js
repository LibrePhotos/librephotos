import { createAction } from '@reduxjs/toolkit'
import jwtDecode from 'jwt-decode'

export default {
  initialState: {
    photos: {},
  },
  action: createAction('photos/addPhotos'),
  reducers(state, { payload }) {
    if (typeof payload.access !== 'undefined') {
      state.access = {
        token: payload.access,
        ...jwtDecode(payload.access),
      }
    }
  },
}
