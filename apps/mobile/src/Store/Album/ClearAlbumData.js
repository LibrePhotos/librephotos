import { createAction } from '@reduxjs/toolkit'

export default {
  initialState: {},
  action: createAction('photos/clearAlbumData'),
  reducers(state, { payload }) {
    state.albumByDate = {}
    state.albumWithoutDate = {}
  },
}
