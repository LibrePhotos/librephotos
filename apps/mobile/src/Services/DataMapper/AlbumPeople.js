import { useAppSelector } from '@/Store/store'

export const albumPeopleMapper = albumPeopleResult => {
  if (
    typeof albumPeopleResult === 'undefined' ||
    albumPeopleResult.length < 1
  ) {
    return []
  }

  let finalmap = albumPeopleResult.map(item => {
    return {
      id: item.id,
      title: item.name,
      url:
        useAppSelector(store => store.config.baseurl) +
        '/media/square_thumbnails/' +
        item.face_photo_url.replace('.webp', ''),
    }
  })

  return finalmap
}
