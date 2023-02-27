import {
  buildAsyncState,
  buildAsyncActions,
  buildAsyncReducers,
} from '@thecodingmachine/redux-toolkit-wrapper'
import api from '@/Services'
import ReplaceAlbumDate from './ReplaceAlbumDate'

export default {
  initialState: buildAsyncState(),
  action: buildAsyncActions(
    'album/fetchAlbumDate',
    async (options, { dispatch }) => {
      var favorites =
        options.photosetType === 'favorites' ? '&favorite=true' : ''
      var publicParam = options.photosetType === 'public' ? '&public=true' : ''
      var usernameParam = options.username
        ? `&username=${options.username.toLowerCase()}`
        : ''
      var personidParam = options.person_id
        ? `&person=${options.person_id}`
        : ''
      return await api
        .get(
          `albums/date/${options.album_date_id}/?page=${options.page}` +
            favorites +
            publicParam +
            usernameParam +
            personidParam,
        )
        .then(response => {
          const datePhotosGroup = response.data.results
          //Replace temp group with fetched group
          dispatch(
            ReplaceAlbumDate.action({
              datePhotosGroup: datePhotosGroup,
              page: options.page,
            }),
          )
        })
        .catch(err => {
          console.log(err)
        })
    },
  ),

  reducers: buildAsyncReducers({ itemKey: null }), // We do not want to modify some item by default
}
