import { FetchDateAlbumResponseSchema, FetchDateAlbumsListResponseSchema } from "../../actions/albumActions.types";
import { IncompleteDatePhotosGroup } from "../../actions/photosActions.types";
import { PhotosetType } from "../../reducers/photosReducer";
import { addTempElementsToGroups } from "../../util/util";
import { api } from "../api";

enum Endpoints {
  fetchDateAlbums = "fetchDateAlbums",
  fetchDateAlbum = "fetchDateAlbum",
}

type AlbumDateListOptions = {
  photosetType: PhotosetType;
  person_id?: number;
  username?: string;
};

type AlbumDateOption = {
  photosetType: PhotosetType;
  album_date_id: string;
  page: number;
  username?: string;
  person_id?: number;
};

export const dateAlbumsApi = api
  .injectEndpoints({
    endpoints: builder => ({
      [Endpoints.fetchDateAlbums]: builder.query<IncompleteDatePhotosGroup[], AlbumDateListOptions>({
        query: options => ({
          url: "albums/date/list/",
          params: {
            favorite: PhotosetType.FAVORITES === options.photosetType ? "true" : undefined,
            public: PhotosetType.PUBLIC === options.photosetType ? "true" : undefined,
            hidden: PhotosetType.HIDDEN === options.photosetType ? "true" : undefined,
            in_trashcan: PhotosetType.IN_TRASHCAN === options.photosetType ? "true" : undefined,
            photo: PhotosetType.PHOTOS === options.photosetType ? "true" : undefined,
            video: PhotosetType.VIDEOS === options.photosetType ? "true" : undefined,
            person: options.person_id,
            username: options.username?.toLowerCase(),
          },
        }),
        transformResponse: response => {
          const { results } = FetchDateAlbumsListResponseSchema.parse(response);
          addTempElementsToGroups(results);
          return results;
        },
      }),
      [Endpoints.fetchDateAlbum]: builder.query<IncompleteDatePhotosGroup, AlbumDateOption>({
        query: options => ({
          url: `albums/date/${options.album_date_id}`,
          params: {
            favorite: PhotosetType.FAVORITES === options.photosetType ? "true" : undefined,
            public: PhotosetType.PUBLIC === options.photosetType ? "true" : undefined,
            hidden: PhotosetType.HIDDEN === options.photosetType ? "true" : undefined,
            in_trashcan: PhotosetType.IN_TRASHCAN === options.photosetType ? "true" : undefined,
            photo: PhotosetType.PHOTOS === options.photosetType ? "true" : undefined,
            video: PhotosetType.VIDEOS === options.photosetType ? "true" : undefined,
            page: options.page,
            person: options.person_id,
            username: options.username?.toLowerCase(),
          },
        }),
        transformResponse: response => FetchDateAlbumResponseSchema.parse(response).results,
        // Add results to fetchDateAlbums cache
        async onQueryStarted(options, { dispatch, queryFulfilled }) {
          const { data } = await queryFulfilled;
          dispatch(
            dateAlbumsApi.util.updateQueryData(
              Endpoints.fetchDateAlbums,
              { photosetType: options.photosetType, person_id: options.person_id, username: options.username },
              draft => {
                const indexToReplace = draft.findIndex(group => group.id === options.album_date_id);
                const groupToChange = draft[indexToReplace];
                if (!groupToChange) return;

                const { items } = groupToChange;
                groupToChange.items = items
                  .slice(0, (options.page - 1) * 100)
                  .concat(data.items)
                  .concat(items.slice(options.page * 100));

                // eslint-disable-next-line no-param-reassign
                draft[indexToReplace] = groupToChange;
              }
            )
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
