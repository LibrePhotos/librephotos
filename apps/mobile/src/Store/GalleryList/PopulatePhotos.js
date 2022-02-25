import { createAction } from '@reduxjs/toolkit'

const photoMapper = photosResult => {
  if (typeof photosResult === 'undefined' || photosResult.length < 1) {
    return []
  }

  let finalmap = photosResult.map(item => {
    return {
      id: item.id,
      title: item.date,
      data: item.items,
      incomplete: item.incomplete,
      numberOfItems: item.numberOfItems,
    }
  })

  return finalmap
}

export default {
  initialState: {},
  action: createAction('gallerylist/populatePhotos'),
  reducers(state, { payload }) {
    if (typeof payload.timelinePhotos !== 'undefined') {
      state.timelinePhotos = photoMapper(payload.timelinePhotos)
      state.lastLoaded = 'timeline'
    }
    if (typeof payload.gridPhotos !== 'undefined') {
      state.gridPhotos = payload.gridPhotos
      state.lastLoaded = 'grid'
    }
    if (typeof payload.loading !== 'undefined') {
      state.loading = payload.loading
    }
  },
}
