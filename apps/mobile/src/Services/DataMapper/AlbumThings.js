import { store } from '@/Store/index'
import { getConfigFromState } from '../Config'

export const albumThingsMapper = albumThingsResult => {
  if (
    typeof albumThingsResult === 'undefined' ||
    albumThingsResult.length < 1
  ) {
    return []
  }

  let finalmap = albumThingsResult.map(item => {
    let photos = item.cover_photos.map((photo, index) => {
      return {
        id: index,
        url: photo.image_hash,
      }
    })

    return {
      id: item.id,
      title: item.title,
      photos: photos,
      url:
        getConfigFromState(store.getState()).MEDIA_URL +
        '/square_thumbnails/' +
        item.cover_photos[0].image_hash,
    }
  })

  return finalmap
}
