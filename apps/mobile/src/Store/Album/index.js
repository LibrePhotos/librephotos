import { buildSlice } from '@thecodingmachine/redux-toolkit-wrapper'
import FetchByDate from './FetchByDate'
import FetchPhotosWithoutDate from './FetchPhotosWithoutDate'
import FetchPeople from './FetchPeople'
import FetchThings from './FetchThings'

// This state is common to all the "user" module, and can be modified by any "user" reducers
const sliceInitialState = {
  albumByDate: {},
  albumWithoutDate: {},
  albumPeople: {},
  albumThings: {},
}

export default buildSlice(
  'album',
  [FetchByDate, FetchPhotosWithoutDate, FetchPeople, FetchThings],
  sliceInitialState,
).reducer
