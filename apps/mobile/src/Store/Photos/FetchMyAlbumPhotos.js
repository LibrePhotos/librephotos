import {
  buildAsyncState,
  buildAsyncActions,
  buildAsyncReducers,
} from '@thecodingmachine/redux-toolkit-wrapper'
import api from '@/Services'
import ClearPersonPhotos from './ClearPersonPhotos'
import PopulatePhotos from '../GalleryList/PopulatePhotos'

export default {
  initialState: buildAsyncState(),
  action: buildAsyncActions(
    'photos/fetchMyAlbum',
    async ({ id }, { dispatch }) => {
      // Clear Photos
      dispatch(
        PopulatePhotos.action({
          timelinePhotos: [],
          loading: true,
        }),
      )

      return await api
        .get('/albums/user/' + id, {
          timeout: 10000,
        })
        .then(response => {
          dispatch(
            PopulatePhotos.action({
              timelinePhotos: response.data.grouped_photos,
              loading: false,
            }),
          )
          return response.data.grouped_photos
        })
    },
  ),
  reducers: buildAsyncReducers({ itemKey: 'myAlbumPhotos' }), // We do not want to modify some item by default
}
