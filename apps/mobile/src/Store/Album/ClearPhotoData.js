import { createAction } from '@reduxjs/toolkit'

export default {
  initialState: {},
  action: createAction('photos/clearPhotoData'),
  reducers(state, { payload }) {
    state.albumByDate = {}
    state.albumWithoutDate = {}
  },
}
