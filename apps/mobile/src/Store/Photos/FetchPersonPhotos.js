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
    'photos/fetchPerson',
    async (args, { dispatch }) => {
      // Clear Photos
      dispatch(
        PopulatePhotos.action({
          timelinePhotos: [],
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
            }),
          )
          return response.data.results.grouped_photos
        })
    },
  ),
  reducers: buildAsyncReducers({ itemKey: 'personPhotos' }), // We do not want to modify some item by default
}
