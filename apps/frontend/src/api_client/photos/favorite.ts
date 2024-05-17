import { z } from "zod";

import { PhotoSchema } from "../../actions/photosActions.types";
import { notification } from "../../service/notifications";
import { api } from "../api";
import { photoDetailsApi } from "./photoDetail";

const FavoritePhotosRequestSchema = z.object({
  image_hashes: z.string().array(),
  favorite: z.boolean(),
});
type FavoritePhotosRequest = z.infer<typeof FavoritePhotosRequestSchema>;

const UpdatedPhotosResponseSchema = z.object({
  status: z.boolean(),
  results: PhotoSchema.array(),
  updated: PhotoSchema.array(),
  not_updated: PhotoSchema.array(),
});
type UpdatedPhotosResponse = z.infer<typeof UpdatedPhotosResponseSchema>;

enum Endpoints {
  setFavoritePhotos = "setFavoritePhotos",
}

export const favoritePhotosApi = api.injectEndpoints({
  endpoints: builder => ({
    [Endpoints.setFavoritePhotos]: builder.mutation<UpdatedPhotosResponse, FavoritePhotosRequest>({
      query: ({ image_hashes, favorite }) => ({
        url: "photosedit/favorite/",
        method: "POST",
        body: {
          image_hashes,
          favorite,
        },
      }),
      async onQueryStarted({ image_hashes, favorite }, { dispatch, queryFulfilled }) {
        dispatch({ type: "SET_PHOTOS_FAVORITE" });
        const response = await queryFulfilled;
        const data = UpdatedPhotosResponseSchema.parse(response.data);
        dispatch({
          type: "SET_PHOTOS_FAVORITE_FULFILLED",
          payload: {
            image_hashes,
            favorite,
            updatedPhotos: data.updated,
          },
        });
        // TODO(sickelap): invalidate tags when we have them
        dispatch(photoDetailsApi.endpoints.fetchPhotoDetails.initiate(image_hashes[0])).refetch();
        notification.togglePhotosFavorite(image_hashes.length, favorite);
      },
    }),
  }),
});

export const { useSetFavoritePhotosMutation } = favoritePhotosApi;
