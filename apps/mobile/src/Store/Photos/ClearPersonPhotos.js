import { createAction } from '@reduxjs/toolkit'

export default {
  initialState: {},
  action: createAction('photos/clearPerson'),
  reducers(state, { payload }) {
    state.personPhotos = []
  },
}
