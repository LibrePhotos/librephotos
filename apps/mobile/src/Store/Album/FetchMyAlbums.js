import {
  buildAsyncState,
  buildAsyncActions,
  buildAsyncReducers,
} from '@thecodingmachine/redux-toolkit-wrapper'
import api from '@/Services'

export default {
  initialState: buildAsyncState(),
  action: buildAsyncActions('album/fetchMyAlbums', async (args, k) => {
    return await api
      .get('/albums/user/list', {
        timeout: 10000,
      })
      .then(response => {
        return response.data
      })
      .catch(e => {
        console.log('Request Failed', e)
        return e
      })
  }),
  reducers: buildAsyncReducers({ itemKey: 'myAlbums' }), // We do not want to modify some item by default
}
