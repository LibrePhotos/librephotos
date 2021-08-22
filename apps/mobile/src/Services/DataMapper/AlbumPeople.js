import { store } from '@/Store/index'
import { extractBaseUrl } from '../Config'

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
        extractBaseUrl(store.getState()) +
        item.face_photo_url.replace('.webp', ''),
    }
  })

  return finalmap
}
