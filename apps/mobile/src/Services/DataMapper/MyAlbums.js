import { store } from '@/Store/store'

export const myAlbumMapper = myAlbumResult => {
  if (typeof myAlbumResult === 'undefined' || myAlbumResult.length < 1) {
    return []
  }

  let finalmap = myAlbumResult.map(item => {
    return {
      id: item.id,
      title: item.title,
      url:
        store.getState().config.baseurl +
        '/media/square_thumbnails/' +
        item.cover_photo.image_hash,
    }
  })

  return finalmap
}
