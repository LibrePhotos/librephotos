import {
  buildAsyncState,
  buildAsyncActions,
  buildAsyncReducers,
} from '@thecodingmachine/redux-toolkit-wrapper'
import api from '@/Services'
import { photoMapper } from '../../Services/DataMapper/PhotosByDate'

export default {
  initialState: buildAsyncState(),
  action: buildAsyncActions('album/fetchByDate', async (args, k) => {
    // To-Do: Should still be able to fetch local images
    return await api
      .get('/albums/date/list/', {
        timeout: 10000,
      })
      .then(response => {
        return photoMapper(response.data?.results)
      })
      .catch(error => {
        console.log(error)
        console.log('Error while fetching photos')
        return []
      })
  }),
  reducers: buildAsyncReducers({ itemKey: 'albumByDate' }), // We do not want to modify some item by default
}
