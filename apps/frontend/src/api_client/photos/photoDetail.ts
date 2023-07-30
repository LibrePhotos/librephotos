import type { Photo } from "../../actions/photosActions.types";
import { api } from "../api";

enum Endpoints {
  fetchPhotoDetails = "fetchPhotoDetails",
}

export const photoDetailsApi = api.injectEndpoints({
  endpoints: builder => ({
    [Endpoints.fetchPhotoDetails]: builder.query<Photo, string>({
      query: hash => `photos/${hash}`,
    }),
  }),
});

export const { useFetchPhotoDetailsQuery } = photoDetailsApi;
