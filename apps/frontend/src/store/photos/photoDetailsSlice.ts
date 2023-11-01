import { createSlice } from "@reduxjs/toolkit";

import type { Photo } from "../../actions/photosActions.types";
import { photoDetailsApi } from "../../api_client/photos/photoDetail";
import type { PhotoSliceState } from "./photoDetail.zod";

const initialState: PhotoSliceState = {
  photoDetails: {},
};

const photoDetailsSlice = createSlice({
  name: "photoDetails",
  initialState: initialState,
  reducers: {},
  extraReducers: builder => {
    builder
      .addMatcher(photoDetailsApi.endpoints.fetchPhotoDetails.matchFulfilled, (state, { payload }) => {
        const newPhotoDetails = { ...state.photoDetails };
        const photoDetails: Photo = payload;
        newPhotoDetails[photoDetails.image_hash] = photoDetails;
        return {
          photoDetails: newPhotoDetails,
        };
      })
      .addDefaultCase(state => state);
  },
});

export const { reducer: photoDetailsReducer, actions: photoDetailsActions } = photoDetailsSlice;
