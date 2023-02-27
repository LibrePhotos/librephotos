import { createSelector } from '@reduxjs/toolkit'

import type { RootState } from '../store'
import { selectSelf } from '../store'

export const selectUserSelfDetails = createSelector(
  selectSelf,
  (state: RootState) => state.user.userSelfDetails,
)
