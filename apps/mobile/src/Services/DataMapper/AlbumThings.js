import { store } from '@/Store/store'

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
        store.getState().config.baseurl +
        '/media/square_thumbnails/' +
        item.cover_photos[0].image_hash,
    }
  })

  return finalmap
}
