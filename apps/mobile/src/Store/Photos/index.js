import { buildSlice } from '@thecodingmachine/redux-toolkit-wrapper'
import FetchPhotos from './FetchPhotos'
import FetchPersonPhotos from './FetchPersonPhotos'
import FetchMyAlbumPhotos from './FetchMyAlbumPhotos'
import ClearPersonPhotos from './ClearPersonPhotos'

// This state is common to all the "user" module, and can be modified by any "user" reducers
const sliceInitialState = {
  photos: {},
  personPhotos: [],
  myAlbumPhotos: [],
}

export default buildSlice(
  'photos',
  [FetchPhotos, FetchPersonPhotos, FetchMyAlbumPhotos, ClearPersonPhotos],
  sliceInitialState,
).reducer
