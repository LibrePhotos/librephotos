import { buildSlice } from '@thecodingmachine/redux-toolkit-wrapper'
import FetchByDate from './FetchByDate'
import FetchPhotosWithoutDate from './FetchPhotosWithoutDate'
import FetchPeople from './FetchPeople'
import FetchThings from './FetchThings'
import FetchMyAlbums from './FetchMyAlbums'

const sliceInitialState = {
  myAlbums: {},
  albumByDate: {},
  albumWithoutDate: {},
  albumPeople: {},
  albumThings: {},
}

export default buildSlice(
  'album',
  [
    FetchByDate,
    FetchPhotosWithoutDate,
    FetchPeople,
    FetchThings,
    FetchMyAlbums,
  ],
  sliceInitialState,
).reducer
