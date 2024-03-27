import { z } from "zod";

import type { Photo } from "../../actions/photosActions.types";
import { PhotoSchema } from "../../actions/photosActions.types";
import { api } from "../api";

enum Endpoints {
  fetchPhotoDetails = "fetchPhotoDetails",
  setPhotosDeleted = "setPhotosDeleted",
}

type PhotosUpdatedResponseType = z.infer<typeof PhotosUpdatedResponseSchema>;

const PhotosUpdatedResponseSchema = z.object({
  status: z.boolean(),
  results: PhotoSchema.array(),
  updated: PhotoSchema.array(),
  not_updated: PhotoSchema.array(),
});

type PhotosUpdatedRequestType = z.infer<typeof PhotosUpdatedRequestSchema>;

const PhotosUpdatedRequestSchema = z.object({
  image_hashes: z.array(z.string()),
  deleted: z.boolean(),
});

export const photoDetailsApi = api.injectEndpoints({
  endpoints: builder => ({
    [Endpoints.fetchPhotoDetails]: builder.query<Photo, string>({
      query: hash => `photos/${hash}`,
    }),
    [Endpoints.setPhotosDeleted]: builder.mutation<PhotosUpdatedResponseType, PhotosUpdatedRequestType>({
      query: ({ image_hashes, deleted }) => ({
        method: "POST",
        body: { image_hashes, deleted },
        url: "photosedit/setdeleted/",
      }),
      transformResponse: response => PhotosUpdatedResponseSchema.parse(response),
    }),
  }),
});

export const { useFetchPhotoDetailsQuery, useSetPhotosDeletedMutation } = photoDetailsApi;
