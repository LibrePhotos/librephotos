import { buildSlice } from '@thecodingmachine/redux-toolkit-wrapper'
import FetchByDate from './FetchByDate'
import FetchPhotosWithoutDate from './FetchPhotosWithoutDate'

// This state is common to all the "user" module, and can be modified by any "user" reducers
const sliceInitialState = {
  albumByDate: {},
  albumWithoutDate: {},
}

export default buildSlice(
  'album',
  [FetchByDate, FetchPhotosWithoutDate],
  sliceInitialState,
).reducer
