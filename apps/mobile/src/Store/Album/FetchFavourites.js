import {
  buildAsyncState,
  buildAsyncActions,
  buildAsyncReducers,
} from '@thecodingmachine/redux-toolkit-wrapper'
import api from '@/Services'
import { photoMapper } from '../../Services/DataMapper/PhotosByDate'

export default {
  initialState: buildAsyncState(),
  action: buildAsyncActions('album/fetchFavourites', async (args, k) => {
    return await api
      .get('/photos/favorites/', {
        timeout: 10000,
      })
      .then(response => {
        return photoMapper(response.data?.results)
      })
  }),
  reducers: buildAsyncReducers({ itemKey: 'albumFavourites' }), // We do not want to modify some item by default
}
