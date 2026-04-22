import type {
  IncompleteDatePhotosGroup,
  PigPhoto,
} from '../api_client/photos/types'

export function addTempElementsToGroups(
  photosGroupedByDate: IncompleteDatePhotosGroup[],
) {
  photosGroupedByDate.forEach(group => {
    for (let i = 0; i < group.numberOfItems; i++) {
      group.items.push({
        id: i.toString(),
        aspectRatio: 1,
        isTemp: true,
      } as PigPhoto)
    }
  })
}

export function addTempElementsToFlatList(photosCount: number) {
  const newPhotosFlat: PigPhoto[] = []
  for (let i = 0; i < photosCount; i++) {
    newPhotosFlat.push({
      id: `temp-${i}`,
      aspectRatio: 1,
      isTemp: true,
    } as PigPhoto)
  }
  return newPhotosFlat
}
