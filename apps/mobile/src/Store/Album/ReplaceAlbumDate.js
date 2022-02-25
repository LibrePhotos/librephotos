import { createAction } from '@reduxjs/toolkit'
import reactotron from 'reactotron-react-native'

export default {
  initialState: {},
  action: createAction('album/replaceAlbumDate'),
  reducers(state, { payload }) {
    reactotron.log(state)
    reactotron.log(payload)
    var page = payload.page
    var newPhotosGroupedByDate = [...state.albumByDate]
    var indexToReplace = newPhotosGroupedByDate.findIndex(
      group => group.id === payload.datePhotosGroup.id,
    )
    reactotron.log(indexToReplace)
    var groupToChange = newPhotosGroupedByDate[indexToReplace]

    if (!groupToChange) {
      return {
        ...state,
      }
    }
    var items = groupToChange.data
    var loadedItems = payload.datePhotosGroup.items
    var updatedItems = items
      .slice(0, (page - 1) * 100)
      .concat(loadedItems)
      .concat(items.slice(page * 100))
    groupToChange.data = updatedItems
    newPhotosGroupedByDate[indexToReplace] = groupToChange
    reactotron.log(newPhotosGroupedByDate)
    state.albumByDate = newPhotosGroupedByDate
  },
}
