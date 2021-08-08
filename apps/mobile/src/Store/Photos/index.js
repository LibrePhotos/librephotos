import { buildSlice } from '@thecodingmachine/redux-toolkit-wrapper'
import FetchPhotos from './FetchPhotos'

// This state is common to all the "user" module, and can be modified by any "user" reducers
const sliceInitialState = {
  photos: {},
}

export default buildSlice('photos', [FetchPhotos], sliceInitialState).reducer
