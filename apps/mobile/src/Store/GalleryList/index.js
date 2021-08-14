import { buildSlice } from '@thecodingmachine/redux-toolkit-wrapper'
import PopulatePhotos from './PopulatePhotos'

// This state is common to all the "user" module, and can be modified by any "user" reducers
const sliceInitialState = {
  timelinePhotos: [],
  gridPhotos: [],
  lastLoaded: 'timeline',
}

export default buildSlice('gallerylist', [PopulatePhotos], sliceInitialState)
  .reducer
