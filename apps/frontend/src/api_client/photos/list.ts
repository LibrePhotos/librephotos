import { z } from "zod";

import { PigPhotoSchema } from "../../actions/photosActions.types";
import { api } from "../api";

const PaginatedPhotosResponseSchema = z.object({
  count: z.number(),
  next: z.string().nullable(),
  previous: z.string().nullable(),
  results: PigPhotoSchema.array(),
});
type PaginatedPhotosResponse = z.infer<typeof PaginatedPhotosResponseSchema>;

enum Endpoints {
  fetchPhotosWithoutTimestamp = "fetchPhotosWithoutTimestamp",
}

export const photoListApi = api.injectEndpoints({
  endpoints: builder => ({
    [Endpoints.fetchPhotosWithoutTimestamp]: builder.query<PaginatedPhotosResponse, number>({
      query: page => `photos/notimestamp/?page=${page}`,
      async onQueryStarted(page, { dispatch, queryFulfilled }) {
        dispatch({ type: "FETCH_NO_TIMESTAMP_PHOTOS_PAGINATED" });
        const response = await queryFulfilled;
        try {
          const data = PaginatedPhotosResponseSchema.parse(response.data);
          dispatch({
            type: "FETCH_NO_TIMESTAMP_PHOTOS_PAGINATED_FULFILLED",
            payload: { photosFlat: data.results, page, photosCount: data.count },
          });
        } catch (e) {
          dispatch({ type: "FETCH_NO_TIMESTAMP_PHOTOS_PAGINATED_REJECTED", payload: e });
        }
      },
    }),
  }),
});

export const { useLazyFetchPhotosWithoutTimestampQuery } = photoListApi;
