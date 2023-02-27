import { createSelector } from '@reduxjs/toolkit'

import type { RootState } from '../store'
import { selectSelf } from '../store'

export const selectUtil = createSelector(
  selectSelf,
  (state: RootState) => state.util,
)

export const selectSiteSettings = createSelector(
  selectSelf,
  (state: RootState) => state.util.siteSettings,
)
