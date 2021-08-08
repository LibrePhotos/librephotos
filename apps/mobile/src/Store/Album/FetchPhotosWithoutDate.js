import {
  buildAsyncState,
  buildAsyncActions,
  buildAsyncReducers,
} from '@thecodingmachine/redux-toolkit-wrapper'
import api from '@/Services'

export default {
  initialState: buildAsyncState(),
  action: buildAsyncActions('album/fetchPhotosWithoutDate', async (args, k) => {
    return await api
      .get('/photos/notimestamp/list/', {
        timeout: 10000,
      })
      .then(response => {
        // k.fulfillWithValue(response.data)
        return response.data
      })
  }),
  reducers: buildAsyncReducers({ itemKey: 'albumWithoutDate' }), // We do not want to modify some item by default
}
