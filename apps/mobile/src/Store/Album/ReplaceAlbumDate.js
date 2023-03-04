import { createAction } from '@reduxjs/toolkit'

export default {
  initialState: {},
  action: createAction('album/replaceAlbumDate'),
  reducers(state, { payload }) {
    var page = payload.page
    var newPhotosGroupedByDate = [...state.albumByDate]
    var indexToReplace = newPhotosGroupedByDate.findIndex(
      group => group.id === payload.datePhotosGroup.id,
    )
    var groupToChange = newPhotosGroupedByDate[indexToReplace]

    if (!groupToChange) {
      return {
        ...state,
      }
    }
    var items = groupToChange.data.filter(item => item.type !== 'cameraroll')
    var localItems = groupToChange.data.filter(
      item => item.type === 'cameraroll',
    )
    var loadedItems = payload.datePhotosGroup.items
    // To-Do: Does not handle files, which have a differend date according to the server
    // Maybe just do a exist check instead
    localItems = localItems.map(localItem => {
      var loadedItem = loadedItems.find(
        loadedItem => loadedItem.id === localItem.id,
      )
      if (loadedItem) {
        localItem.type = 'synced'
        return localItem
      } else {
        return localItem
      }
    })
    loadedItems = loadedItems.filter(
      loadedItem =>
        !localItems.find(localItem => localItem.id === loadedItem.id),
    )
    var updatedItems = items
      .slice(0, (page - 1) * 100)
      .concat(loadedItems)
      .concat(items.slice(page * 100))
      .concat(localItems)

    updatedItems = updatedItems.sort((a, b) => {
      return new Date(b.date) - new Date(a.date)
    })

    groupToChange.data = updatedItems
    newPhotosGroupedByDate[indexToReplace] = groupToChange
    state.albumByDate = newPhotosGroupedByDate
  },
}
