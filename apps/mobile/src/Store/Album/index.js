import { buildSlice } from '@thecodingmachine/redux-toolkit-wrapper'
import FetchByDate from './FetchByDate'
import FetchAlbumDate from './FetchAlbumDate'
import FetchPhotosWithoutDate from './FetchPhotosWithoutDate'
import FetchPeople from './FetchPeople'
import FetchThings from './FetchThings'
import FetchMyAlbums from './FetchMyAlbums'
import ClearAlbumData from './ClearAlbumData'
import ClearPhotoData from './ClearPhotoData'
import FetchRecentlyAdded from './FetchRecentlyAdded'
import FetchFavourites from './FetchFavourites'
import FetchHidden from './FetchHidden'
import FetchPublic from './FetchPublic'
import ReplaceAlbumDate from './ReplaceAlbumDate'
import ReplaceFlatList from './ReplaceFlatList'

const sliceInitialState = {
  myAlbums: {},
  albumByDate: [],
  albumWithoutDate: [],
  albumRecentlyAdded: {},
  albumFavourites: [],
  albumHidden: [],
  albumPublic: [],
  albumPeople: {},
  albumThings: {},
}

export default buildSlice(
  'album',
  [
    FetchByDate,
    FetchAlbumDate,
    ReplaceAlbumDate,
    ReplaceFlatList,
    FetchPhotosWithoutDate,
    FetchRecentlyAdded,
    FetchFavourites,
    FetchHidden,
    FetchPublic,
    FetchPeople,
    FetchThings,
    FetchMyAlbums,
    ClearAlbumData,
    ClearPhotoData,
  ],
  sliceInitialState,
).reducer
