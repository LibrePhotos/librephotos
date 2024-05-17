import { z } from "zod";

import type { Photo } from "../../actions/photosActions.types";
import { notification } from "../../service/notifications";
import { api } from "../api";

const PhotoUpdateResponseSchema = z.object({
  image_hash: z.string(),
  hidden: z.boolean(),
  rating: z.number(),
  deleted: z.boolean(),
  video: z.boolean(),
  exif_timestamp: z.string(),
  timestamp: z.string(),
});
type PhotoUpdateResponse = z.infer<typeof PhotoUpdateResponseSchema>;

const StatusResponseSchema = z.object({
  status: z.boolean(),
});
type StatusResponse = z.infer<typeof StatusResponseSchema>;

enum Endpoints {
  fetchPhotoDetails = "fetchPhotoDetails",
  updatePhoto = "updatePhoto",
  savePhotoCaption = "savePhotoCaption",
  generateImageToTextCaption = "generateImageToTextCaption",
}

export const photoDetailsApi = api.injectEndpoints({
  endpoints: builder => ({
    [Endpoints.fetchPhotoDetails]: builder.query<Photo, string>({
      query: hash => `photos/${hash}/`,
    }),
    [Endpoints.updatePhoto]: builder.mutation<PhotoUpdateResponse, { id: string; data: Partial<Photo> }>({
      query: ({ id, data }) => ({
        method: "PATCH",
        url: `photos/edit/${id}/`,
        body: data,
      }),
      async onQueryStarted(_, { queryFulfilled, dispatch }) {
        dispatch({ type: "EDIT_PHOTO" });
        try {
          const response = await queryFulfilled;
          const data = PhotoUpdateResponseSchema.parse(response.data);
          dispatch({ type: "EDIT_PHOTO_FULFILLED" });
          notification.updatePhoto();
          dispatch(photoDetailsApi.endpoints.fetchPhotoDetails.initiate(data.image_hash)).refetch();
        } catch (error) {
          dispatch({ type: "EDIT_PHOTO_REJECTED", payload: error });
        }
      },
    }),
    [Endpoints.savePhotoCaption]: builder.mutation<StatusResponse, { id: string; caption: string }>({
      query: ({ id, caption }) => ({
        method: "POST",
        url: `photosedit/savecaption/`,
        body: { image_hash: id, caption },
      }),
      async onQueryStarted({ id }, { queryFulfilled, dispatch }) {
        const response = await queryFulfilled;
        StatusResponseSchema.parse(response.data);
        dispatch(photoDetailsApi.endpoints.fetchPhotoDetails.initiate(id)).refetch();
        notification.savePhotoCaptions();
      },
    }),
    [Endpoints.generateImageToTextCaption]: builder.mutation<void, { id: string }>({
      query: ({ id }) => ({
        method: "POST",
        url: `photosedit/generateim2txt/`,
        body: { image_hash: id },
      }),
      async onQueryStarted({ id }, { queryFulfilled, dispatch }) {
        const response = await queryFulfilled;
        StatusResponseSchema.parse(response.data);
        dispatch(photoDetailsApi.endpoints.fetchPhotoDetails.initiate(id)).refetch();
      },
    }),
  }),
});

export const { useUpdatePhotoMutation, useSavePhotoCaptionMutation, useGenerateImageToTextCaptionMutation } =
  photoDetailsApi;
