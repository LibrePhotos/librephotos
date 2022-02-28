import {
  buildAsyncState,
  buildAsyncActions,
  buildAsyncReducers,
} from '@thecodingmachine/redux-toolkit-wrapper'
import api from '@/Services'

export default {
  initialState: buildAsyncState(),
  action: buildAsyncActions('album/fetchPeople', async (args, k) => {
    return await api
      .get('/persons/', {
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
  reducers: buildAsyncReducers({ itemKey: 'albumPeople' }), // We do not want to modify some item by default
}
