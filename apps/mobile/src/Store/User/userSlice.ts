import type { PayloadAction } from '@reduxjs/toolkit'
import { createSlice } from '@reduxjs/toolkit'

import { api } from '../api'
import type { IUser, IUserState } from './user.zod'
import { UserSchema } from './user.zod'

const initialState: IUserState = {
  userSelfDetails: {} as IUser,
  error: null,
}

const userSlice = createSlice({
  name: 'user',
  initialState: initialState,
  reducers: {
    setRules: (state, action: PayloadAction<string>) => ({
      ...state,
      userSelfDetails: UserSchema.parse({
        ...state.userSelfDetails,
        datetime_rules: action.payload,
      }),
    }),
    updateRules: (state, action: PayloadAction<Partial<IUser>>) => ({
      ...state,
      userSelfDetails: UserSchema.parse({
        ...state.userSelfDetails,
        favorite_min_rating:
          action.payload.favorite_min_rating ??
          state.userSelfDetails.favorite_min_rating,
        save_metadata_to_disk:
          action.payload.save_metadata_to_disk ??
          state.userSelfDetails.save_metadata_to_disk,
      }),
    }),
  },
  extraReducers: builder => {
    builder
      .addMatcher(
        api.endpoints.fetchUserSelfDetails.matchFulfilled,
        (state, { payload }) => ({
          ...state,
          userSelfDetails: UserSchema.parse(payload),
        }),
      )
      .addMatcher(
        api.endpoints.fetchUserSelfDetails.matchRejected,
        (state, { payload }) => ({
          ...state,
          error: payload,
        }),
      )
      .addMatcher(
        api.endpoints.fetchPredefinedRules.matchRejected,
        (state, { payload }) => ({
          ...state,
          error: payload,
        }),
      )
      .addDefaultCase(state => state)
  },
})

export const { reducer: userReducer, actions: userActions } = userSlice
