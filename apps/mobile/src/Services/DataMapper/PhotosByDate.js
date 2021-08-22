import { imageGridReducer } from './ImageGridReducer'

export const photoMapper = photosResult => {
  if (typeof photosResult === 'undefined' || photosResult.length < 1) {
    return []
  }

  let finalmap = photosResult.map(item => {
    return {
      id: item.date,
      title: item.date,
      data: imageGridReducer(item.items),
    }
  })

  return finalmap
}
