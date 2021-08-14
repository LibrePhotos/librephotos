import { buildSlice } from '@thecodingmachine/redux-toolkit-wrapper'
import FetchPhotos from './FetchPhotos'
import FetchPersonPhotos from './FetchPersonPhotos'
import ClearPersonPhotos from './ClearPersonPhotos'

// This state is common to all the "user" module, and can be modified by any "user" reducers
const sliceInitialState = {
  photos: {},
  personPhotos: [],
}

export default buildSlice(
  'photos',
  [FetchPhotos, FetchPersonPhotos, ClearPersonPhotos],
  sliceInitialState,
).reducer
