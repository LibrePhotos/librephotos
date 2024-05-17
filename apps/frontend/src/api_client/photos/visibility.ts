import { z } from "zod";

import { PhotoSchema } from "../../actions/photosActions.types";
import { notification } from "../../service/notifications";
import { api } from "../api";
import { photoDetailsApi } from "./photoDetail";

const UpdatePhotosResponseSchema = z.object({
  status: z.boolean(),
  results: PhotoSchema.array(),
  updated: PhotoSchema.array(),
  not_updated: PhotoSchema.array(),
});
type UpdatePhotosResponse = z.infer<typeof UpdatePhotosResponseSchema>;

const SetPhotosPublicRequestSchema = z.object({
  image_hashes: z.array(z.string()),
  val_public: z.boolean(),
});
type SetPhotosPublicRequest = z.infer<typeof SetPhotosPublicRequestSchema>;

const SetPhotosHiddenRequestSchema = z.object({
  image_hashes: z.array(z.string()),
  hidden: z.boolean(),
});
type SetPhotosHiddenRequest = z.infer<typeof SetPhotosHiddenRequestSchema>;

enum Endpoints {
  setPhotosPublic = "setPhotosPublic",
  setPhotosHidden = "setPhotosHidden",
}

export const photoVisibilityApi = api.injectEndpoints({
  endpoints: builder => ({
    [Endpoints.setPhotosPublic]: builder.mutation<UpdatePhotosResponse, SetPhotosPublicRequest>({
      query: ({ image_hashes, val_public }) => ({
        url: "photosedit/makepublic/",
        method: "POST",
        body: { image_hashes, val_public },
      }),
      async onQueryStarted({ image_hashes, val_public }, { dispatch, queryFulfilled }) {
        dispatch({ type: "SET_PHOTOS_PUBLIC" });
        const response = await queryFulfilled;
        const { updated: updatedPhotos } = UpdatePhotosResponseSchema.parse(response.data);
        dispatch({
          type: "SET_PHOTOS_PUBLIC_FULFILLED",
          payload: {
            image_hashes,
            val_public,
            updatedPhotos,
          },
        });
        notification.togglePhotosPublic(image_hashes.length, true);
        if (image_hashes.length === 1) {
          // TODO(sickelap): invalidate tags when we have them
          dispatch(photoDetailsApi.endpoints.fetchPhotoDetails.initiate(image_hashes[0])).refetch();
        }
      },
    }),
    [Endpoints.setPhotosHidden]: builder.mutation<UpdatePhotosResponse, SetPhotosHiddenRequest>({
      query: ({ image_hashes, hidden }) => ({
        url: "photosedit/hide/",
        method: "POST",
        body: { image_hashes, hidden },
      }),
      async onQueryStarted({ image_hashes, hidden }, { dispatch, queryFulfilled }) {
        dispatch({ type: "SET_PHOTOS_HIDDEN" });
        const response = await queryFulfilled;
        const { updated: updatedPhotos } = UpdatePhotosResponseSchema.parse(response.data);
        dispatch({
          type: "SET_PHOTOS_HIDDEN_FULFILLED",
          payload: {
            image_hashes,
            hidden,
            updatedPhotos,
          },
        });
        notification.togglePhotosHidden(image_hashes.length, false);
        if (image_hashes.length === 1) {
          // TODO(sickelap): invalidate tags when we have them
          dispatch(photoDetailsApi.endpoints.fetchPhotoDetails.initiate(image_hashes[0])).refetch();
        }
      },
    }),
  }),
});

export const { useSetPhotosHiddenMutation, useSetPhotosPublicMutation } = photoVisibilityApi;
