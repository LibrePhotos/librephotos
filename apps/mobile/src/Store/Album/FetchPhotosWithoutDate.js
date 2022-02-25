import {
  buildAsyncState,
  buildAsyncActions,
  buildAsyncReducers,
} from '@thecodingmachine/redux-toolkit-wrapper'
import api from '@/Services'
import ReplaceFlatList from './ReplaceFlatList'

export default {
  initialState: buildAsyncState(),
  action: buildAsyncActions(
    'album/fetchPhotosWithoutDate',
    async (options, { dispatch }) => {
      var page = options.page ? options.page : 1
      return await api
        .get(`/photos/notimestamp/?page=${page}`, {
          timeout: 10000,
        })
        .then(response => {
          dispatch(
            ReplaceFlatList.action({
              fetchedPage: page,
              photosCount: response.data.count,
              photosFlat: response.data.results,
            }),
          )
        })
    },
  ),
  reducers: buildAsyncReducers({ itemKey: null }), // We do not want to modify some item by default
}
