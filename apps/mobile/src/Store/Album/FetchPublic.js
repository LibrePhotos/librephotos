import {
  buildAsyncState,
  buildAsyncActions,
  buildAsyncReducers,
} from '@thecodingmachine/redux-toolkit-wrapper'
import api from '@/Services'
import { photoMapper } from '../../Services/DataMapper/PhotosByDate'

export default {
  initialState: buildAsyncState(),
  action: buildAsyncActions('album/fetchPublic', async (args, k) => {
    return await api
      .get('/photos/public/?username=admin', {
        timeout: 10000,
      })
      .then(response => {
        return photoMapper(response.data?.results)
      })
  }),
  reducers: buildAsyncReducers({ itemKey: 'albumPublic' }), // We do not want to modify some item by default
}
