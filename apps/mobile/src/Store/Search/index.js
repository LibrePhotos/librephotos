import { buildSlice } from '@thecodingmachine/redux-toolkit-wrapper'
import FindPhotos from './FindPhotos'
import UpdateQuery from './UpdateQuery'

export default buildSlice('search', [FindPhotos, UpdateQuery], {
  searchResults: [],
  query: null,
}).reducer
