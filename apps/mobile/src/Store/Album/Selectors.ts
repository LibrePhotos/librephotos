import { createSelector } from '@reduxjs/toolkit'
import { SyncStatus } from '../LocalImages/LocalImages.zod'
import type { RootState } from '../../Store/store'

export const selectAlbumDateWithLocalImages = createSelector(
  (state: RootState) => state.album.albumByDate,
  (state: RootState) => state.localImages.images,
  (albumByDate, localPhotos) => {
    let albumWithLocalPhotos = [...albumByDate]
    localPhotos.forEach(photo => {
      let date = photo.birthTime
      // check if date exists within finalmap
      let index = albumWithLocalPhotos.findIndex(x => x.title === date)
      if (index === -1) {
        const newAlbumDate = {
          id: date,
          title: date,
          data: [photo],
          incomplete: false,
          numberOfItems: 1,
        }
        albumWithLocalPhotos = [...albumWithLocalPhotos, newAlbumDate]

        albumWithLocalPhotos.sort((a, b) => {
          return new Date(b.title) - new Date(a.title)
        })
      }
      // add to existing date
      else {
        var changedAlbumDate = albumWithLocalPhotos[index]
        var updatedItems = [
          ...changedAlbumDate.data.filter(i => i.id !== photo.id),
          photo,
        ].sort((a, b) => {
          return new Date(b.date) - new Date(a.date)
        })

        changedAlbumDate.data = updatedItems
        if (photo.syncStatus === SyncStatus.LOCAL) {
          changedAlbumDate.numberOfItems += 1
        }
      }
      return albumWithLocalPhotos
    })
    // remove temp elements in the number of synced local images on the same day
    albumWithLocalPhotos.forEach(albumDate => {
      const numberOfSyncedItems = albumDate.data.filter(
        photo => photo.syncStatus === SyncStatus.SYNCED,
      ).length
      const allTempElements = albumDate.data
        .filter(photo => photo.isTemp === true)
        .slice(0, numberOfSyncedItems)
      albumDate.data = albumDate.data.filter(
        photo => allTempElements.indexOf(photo) === -1,
      )
    })

    return albumWithLocalPhotos
  },
)
