import {
  buildAsyncState,
  buildAsyncActions,
  buildAsyncReducers,
} from '@thecodingmachine/redux-toolkit-wrapper'
import api from '@/Services'
import PopulatePhotos from '../GalleryList/PopulatePhotos'

export default {
  initialState: buildAsyncState(),
  action: buildAsyncActions(
    'photos/fetchPerson',
    async (args, { dispatch }) => {
      // Clear Photos
      dispatch(
        PopulatePhotos.action({
          timelinePhotos: [],
          loaing: true,
        }),
      )

      return await api
        .get('/albums/person/' + args.id, {
          timeout: 10000,
        })
        .then(response => {
          dispatch(
            PopulatePhotos.action({
              timelinePhotos: response.data.results.grouped_photos,
              loading: false,
            }),
          )
          return response.data.results.grouped_photos
        })
    },
  ),
  reducers: buildAsyncReducers({ itemKey: 'personPhotos' }), // We do not want to modify some item by default
}
