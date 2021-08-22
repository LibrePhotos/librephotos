import { buildSlice } from '@thecodingmachine/redux-toolkit-wrapper'
import FetchByDate from './FetchByDate'
import FetchPhotosWithoutDate from './FetchPhotosWithoutDate'
import FetchPeople from './FetchPeople'
import FetchThings from './FetchThings'
import FetchMyAlbums from './FetchMyAlbums'
import ClearAlbumData from './ClearAlbumData'
import ClearPhotoData from './ClearPhotoData'

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
    ClearAlbumData,
    ClearPhotoData,
  ],
  sliceInitialState,
).reducer
