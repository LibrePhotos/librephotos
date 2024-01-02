import _ from "lodash";
import { z } from "zod";

import { UserPhotosGroup } from "../../actions/photosActions";
import { PigPhotoSchema, SimpleUserSchema } from "../../actions/photosActions.types";
import { api } from "../api";

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

enum Endpoints {
  fetchSharedPhotosByMe = "fetchSharedPhotosByMe",
  fetchSharedPhotosWithMe = "fetchSharedPhotosWithMe",
}

export const sharingPhotosApi = api
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
    }),
  })
  .enhanceEndpoints<"SharedPhotosByMe" | "SharedPhotosWithMe">({
    addTagTypes: ["SharedPhotosByMe", "SharedPhotosWithMe"],
    endpoints: {
      [Endpoints.fetchSharedPhotosByMe]: {
        providesTags: ["SharedPhotosByMe"],
      },
      [Endpoints.fetchSharedPhotosWithMe]: {
        providesTags: ["SharedPhotosWithMe"],
      },
    },
  });

export const { useFetchSharedPhotosByMeQuery, useFetchSharedPhotosWithMeQuery } = sharingPhotosApi;
