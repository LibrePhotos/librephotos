import {
  buildAsyncState,
  buildAsyncActions,
  buildAsyncReducers,
} from '@thecodingmachine/redux-toolkit-wrapper'
import api from '@/Services'

export default {
  initialState: buildAsyncState(),
  action: buildAsyncActions('album/fetchRecentlyAdded', async (args, k) => {
    return await api
      .get('/photos/recentlyadded', {
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
  reducers: buildAsyncReducers({ itemKey: 'albumRecentlyAdded' }), // We do not want to modify some item by default
}
