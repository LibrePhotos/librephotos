import _ from "lodash";
import { z } from "zod";

import { PigPhoto, PigPhotoSchema, SimpleUserSchema } from "../../actions/photosActions.types";
import { notification } from "../../service/notifications";
import { api } from "../api";
import { photoDetailsApi } from "./photoDetail";

const SharedPhotosByMeResponseSchema = z.object({
  results: z
    .object({
      user_id: z.number(),
      user: SimpleUserSchema,
      photo: PigPhotoSchema,
    })
    .array(),
});
const SharedPhotosWithMeResponseSchema = z.object({
  results: PigPhotoSchema.array(),
});

const SharePhotosRequestSchema = z.object({
  image_hashes: z.string().array(),
  val_shared: z.boolean(),
  target_user: SimpleUserSchema,
});
type SharePhotosRequest = z.infer<typeof SharePhotosRequestSchema>;

type UserPhotosGroup = {
  userId: number;
  photos: PigPhoto[];
};

enum Endpoints {
  fetchSharedPhotosByMe = "fetchSharedPhotosByMe",
  fetchSharedPhotosWithMe = "fetchSharedPhotosWithMe",
  updatePhotoSharing = "updatePhotoSharing",
}

export const photoSharingApi = api
  .injectEndpoints({
    endpoints: builder => ({
      [Endpoints.fetchSharedPhotosByMe]: builder.query<UserPhotosGroup[], void>({
        query: () => "photos/shared/fromme/",
        transformResponse: response => {
          const { results } = SharedPhotosByMeResponseSchema.parse(response);
          return _.toPairs(_.groupBy(results, "user_id")).map(el => ({
            userId: parseInt(el[0], 10),
            photos: el[1].map(item => item.photo),
          }));
        },
      }),
      [Endpoints.fetchSharedPhotosWithMe]: builder.query<UserPhotosGroup[], void>({
        query: () => "photos/shared/tome/",
        transformResponse: response => {
          const { results } = SharedPhotosWithMeResponseSchema.parse(response);
          return _.toPairs(_.groupBy(results, "owner.id")).map(el => ({ userId: parseInt(el[0], 10), photos: el[1] }));
        },
      }),
      [Endpoints.updatePhotoSharing]: builder.mutation<void, SharePhotosRequest>({
        query: ({ image_hashes, val_shared, target_user }) => ({
          method: "POST",
          body: {
            image_hashes,
            val_shared,
            target_user_id: target_user.id,
          },
          url: "photosedit/share/",
        }),
        async onQueryStarted({ target_user, image_hashes, val_shared }, { queryFulfilled, dispatch }) {
          await queryFulfilled;
          notification.togglePhotoSharing(target_user.username, image_hashes.length, val_shared);
          if (image_hashes.length === 1) {
            // TODO(sickelap): invalidate tags when we have them
            dispatch(photoDetailsApi.endpoints.fetchPhotoDetails.initiate(image_hashes[0])).refetch();
          }
        },
      }),
    }),
  })
  .enhanceEndpoints<"SharedPhotosByMe" | "SharedPhotosWithMe" | "RecentlyAddedPhotos">({
    addTagTypes: ["SharedPhotosByMe", "SharedPhotosWithMe", "RecentlyAddedPhotos"],
    endpoints: {
      [Endpoints.fetchSharedPhotosByMe]: {
        providesTags: ["SharedPhotosByMe"],
      },
      [Endpoints.fetchSharedPhotosWithMe]: {
        providesTags: ["SharedPhotosWithMe"],
      },
    },
  });

export const { useFetchSharedPhotosByMeQuery, useFetchSharedPhotosWithMeQuery, useUpdatePhotoSharingMutation } =
  photoSharingApi;
