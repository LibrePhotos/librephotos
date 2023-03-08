import { imageGridReducer } from './ImageGridReducer'

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
  if (typeof photosResult === 'undefined' || photosResult.length < 1) {
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

  return finalmap
}
