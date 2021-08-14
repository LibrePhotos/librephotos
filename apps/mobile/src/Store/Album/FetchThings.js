import {
  buildAsyncState,
  buildAsyncActions,
  buildAsyncReducers,
} from '@thecodingmachine/redux-toolkit-wrapper'
import api from '@/Services'

export default {
  initialState: buildAsyncState(),
  action: buildAsyncActions('album/fetchThings', async (args, k) => {
    return await api
      .get('/albums/thing/list', {
        timeout: 10000,
      })
      .then(response => {
        return response.data
      })
  }),
  reducers: buildAsyncReducers({ itemKey: 'albumThings' }), // We do not want to modify some item by default
}
