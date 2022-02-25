import { createAction } from '@reduxjs/toolkit'
import reactotron from 'reactotron-react-native'
export function addTempElementsToFlatList(photosCount) {
  var newPhotosFlat = []
  for (var i = 0; i < photosCount; i++) {
    newPhotosFlat.push({
      id: i.toString(),
      aspectRatio: 1,
      isTemp: true,
    })
  }
  return newPhotosFlat
}

export default {
  initialState: {},
  action: createAction('album/replaceFlatList'),
  reducers(state, { payload }) {
    reactotron.log(payload)
    reactotron.log(state)
    var fetched_page = payload.fetchedPage
    var photos_count = payload.photosCount
    var current_photos = [...state.albumWithoutDate]
    if (fetched_page == 1) {
      current_photos = addTempElementsToFlatList(photos_count)
    }
    var newPhotosFlat = current_photos
      .slice(0, (fetched_page - 1) * 100)
      .concat(payload.photosFlat)
      .concat(current_photos.slice(fetched_page * 100))
    reactotron.log(newPhotosFlat)
    state.albumWithoutDate = newPhotosFlat
  },
}
