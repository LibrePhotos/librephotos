import {
  buildAsyncState,
  buildAsyncActions,
  buildAsyncReducers,
} from '@thecodingmachine/redux-toolkit-wrapper'
import api from '@/Services'

export default {
  initialState: buildAsyncState(),
  action: buildAsyncActions(
    'photos/fetchPhotos',
    async (args, { dispatch }) => {
      await api
        .get('/photos/', {
          timeout: 10000,
        })
        .then(response => {
          console.log('fetchPhotos successful', response.data.results)
        })
    },
  ),
  reducers: buildAsyncReducers({ itemKey: null }), // We do not want to modify some item by default
}
