import { imageGridReducer } from './ImageGridReducer'
import { RootState, store } from '../../Store/store'

export function addTempElementsToGroups(photosGroupedByDate) {
  photosGroupedByDate.forEach(group => {
    for (var i = 0; i < group.numberOfItems; i++) {
      group.items.push({
        id: i.toString(),
        aspectRatio: 1,
        isTemp: true,
      })
    }
  })
}

export const photoMapper = photosResult => {
  const localPhotos = (store.getState() as RootState).localImages.images
  if (
    (typeof photosResult === 'undefined' || photosResult.length < 1) &&
    localPhotos.length < 1
  ) {
    return []
  }
  addTempElementsToGroups(photosResult)
  var finalmap = photosResult.map(item => {
    return {
      id: item.id,
      title: item.date,
      data: imageGridReducer(item.items),
      incomplete: item.incomplete,
      numberOfItems: item.numberOfItems,
    }
  })

  localPhotos.forEach(photo => {
    let date = photo.birthTime
    // check if date exists within finalmap
    let index = finalmap.findIndex(x => x.title === date)
    if (index === -1) {
      const newAlbumDate = {
        id: date,
        title: date,
        data: photo,
        incomplete: false,
        numberOfItems: 1,
      }
      finalmap = [...finalmap, newAlbumDate]

      finalmap.sort((a, b) => {
        return new Date(b.title) - new Date(a.title)
      })
    }
    // add to existing date
    else {
      var changedAlbumDate = finalmap[index]
      changedAlbumDate.data = [...changedAlbumDate.data, photo]
      changedAlbumDate.numberOfItems += 1
    }
  })

  return finalmap
}
