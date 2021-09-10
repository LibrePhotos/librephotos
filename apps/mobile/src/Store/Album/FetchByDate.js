import {
  buildAsyncState,
  buildAsyncActions,
  buildAsyncReducers,
} from '@thecodingmachine/redux-toolkit-wrapper'
import api from '@/Services'

export default {
  initialState: buildAsyncState(),
  action: buildAsyncActions('album/fetchByDate', async (args, k) => {
    return await api
      .get('/albums/date/photohash/list/', {
        timeout: 10000,
      })
      .then(response => {
        return response.data
      })
  }),
  reducers: buildAsyncReducers({ itemKey: 'albumByDate' }), // We do not want to modify some item by default
}
