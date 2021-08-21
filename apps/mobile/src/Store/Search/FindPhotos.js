import {
  buildAsyncState,
  buildAsyncActions,
  buildAsyncReducers,
} from '@thecodingmachine/redux-toolkit-wrapper'
import api from '@/Services'
import { SearchService } from '@/Services/Photos'
import UpdateQuery from './UpdateQuery'

export default {
  initialState: buildAsyncState(),
  action: buildAsyncActions(
    'search/findPhotos',
    async ({ searchQuery }, { dispatch }) => {
      dispatch(UpdateQuery.action({ searchQuery }))
      return SearchService(searchQuery)
    },
  ),
  reducers: buildAsyncReducers({ itemKey: 'searchResults' }), // We do not want to modify some item by default
}
