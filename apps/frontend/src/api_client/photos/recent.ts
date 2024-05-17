import { z } from "zod";

import { PigPhotoSchema } from "../../actions/photosActions.types";
import { api } from "../api";

const RecentlyAddedPhotosResponseSchema = z.object({
  results: PigPhotoSchema.array(),
  date: z.string(),
});
type RecentlyAddedPhotosResponse = z.infer<typeof RecentlyAddedPhotosResponseSchema>;

enum Endpoints {
  fetchRecentlyAddedPhotos = "fetchRecentlyAddedPhotos",
}

export const recentPhotosApi = api
  .injectEndpoints({
    endpoints: builder => ({
      [Endpoints.fetchRecentlyAddedPhotos]: builder.query<RecentlyAddedPhotosResponse, void>({
        query: () => "photos/recentlyadded/",
        async onQueryStarted(_args, { queryFulfilled, dispatch }) {
          dispatch({ type: "FETCH_RECENTLY_ADDED_PHOTOS" });
          const response = await queryFulfilled;
          const { results: photosFlat, date } = RecentlyAddedPhotosResponseSchema.parse(response.data);
          dispatch({
            type: "FETCH_RECENTLY_ADDED_PHOTOS_FULFILLED",
            payload: { photosFlat, date },
          });
        },
      }),
    }),
  })
  .enhanceEndpoints<"RecentlyAddedPhotos">({
    addTagTypes: ["RecentlyAddedPhotos"],
    endpoints: {
      [Endpoints.fetchRecentlyAddedPhotos]: {
        providesTags: ["RecentlyAddedPhotos"],
      },
    },
  });

export const { useLazyFetchRecentlyAddedPhotosQuery } = recentPhotosApi;
