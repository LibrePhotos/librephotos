import { store } from '@/Store/index'
import { getConfigFromState } from '../Config'

export const myAlbumMapper = myAlbumResult => {
  if (typeof myAlbumResult === 'undefined' || myAlbumResult.length < 1) {
    return []
  }

  let finalmap = myAlbumResult.map(item => {
    return {
      id: item.id,
      title: item.title,
      url:
        getConfigFromState(store.getState()).MEDIA_URL +
        '/square_thumbnails/' +
        item.cover_photos[0].image_hash,
    }
  })

  return finalmap
}
