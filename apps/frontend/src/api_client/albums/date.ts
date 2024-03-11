import { FetchDateAlbumResponseSchema, FetchDateAlbumsListResponseSchema } from "../../actions/albumActions.types";
import { IncompleteDatePhotosGroup } from "../../actions/photosActions.types";
import { addTempElementsToGroups } from "../../util/util";
import { api } from "../api";

enum Endpoints {
  fetchDateAlbums = "fetchDateAlbums",
  fetchDateAlbum = "fetchDateAlbum",
}

export const dateAlbumsApi = api
  .injectEndpoints({
    endpoints: builder => ({
      [Endpoints.fetchDateAlbums]: builder.query<IncompleteDatePhotosGroup[], void>({
        query: () => "albums/date/list/",
        transformResponse: response => {
          const { results } = FetchDateAlbumsListResponseSchema.parse(response);
          addTempElementsToGroups(results);

          return results;
        },
      }),
      [Endpoints.fetchDateAlbum]: builder.query<IncompleteDatePhotosGroup, { id: string; page: number }>({
        query: ({ id, page }) => `albums/date/${id}/?page=${page}`,
        transformResponse: response => FetchDateAlbumResponseSchema.parse(response).results,
        // Add results to fetchDateAlbums cache
        async onQueryStarted({ id, page }, { dispatch, queryFulfilled }) {
          const { data } = await queryFulfilled;

          dispatch(
            dateAlbumsApi.util.updateQueryData(Endpoints.fetchDateAlbums, undefined, draft => {
              const indexToReplace = draft.findIndex(group => group.id === id);
              const groupToChange = draft[indexToReplace];
              if (!groupToChange) return;

              const { items } = groupToChange;
              groupToChange.items = items
                .slice(0, (page - 1) * 100)
                .concat(data.items)
                .concat(items.slice(page * 100));

              // eslint-disable-next-line no-param-reassign
              draft[indexToReplace] = groupToChange;
            })
          );
        },
      }),
    }),
  })
  .enhanceEndpoints<"DateAlbums" | "DateAlbum">({
    addTagTypes: ["DateAlbums", "DateAlbum"],
    endpoints: {
      [Endpoints.fetchDateAlbums]: {
        providesTags: ["DateAlbums"],
      },
      [Endpoints.fetchDateAlbum]: {
        providesTags: ["DateAlbum"],
      },
    },
  });

export const { useFetchDateAlbumsQuery, useFetchDateAlbumQuery } = dateAlbumsApi;
