import { showNotification } from "@mantine/notifications";
import _ from "lodash";

import i18n from "../../i18n";
import { api } from "../api";
import type { UserAlbumList } from "./types";
import { UserAlbumListResponseSchema } from "./types";

enum Endpoints {
  shareUserAlbum = "shareUserAlbum",
  fetchSharedAlbumsByMe = "fetchSharedAlbumsByMe",
  fetchSharedAlbumsWithMe = "fetchSharedAlbumsWithMe",
}

type ShareUserAlbumParams = {
  albumId: string;
  userId: string;
  share: boolean;
};

type UserAlbumsGroupedByUserId = {
  user_id: number;
  albums: UserAlbumList[];
};

export const sharedUserAlbumsApi = api
  .injectEndpoints({
    endpoints: builder => ({
      [Endpoints.shareUserAlbum]: builder.mutation<void, ShareUserAlbumParams>({
        query: ({ albumId, userId, share }) => ({
          url: `useralbum/share/`,
          method: "POST",
          body: { shared: share, album_id: albumId, target_user_id: userId },
        }),
        transformResponse: (response, meta, query) => {
          if (query.share) {
            showNotification({
              message: i18n.t("toasts.sharingalbum"),
              title: i18n.t("toasts.sharingalbumtitle"),
              color: "teal",
            });
          } else {
            showNotification({
              message: i18n.t("toasts.unsharingalbum"),
              title: i18n.t("toasts.unsharingalbumtitle"),
              color: "teal",
            });
          }
        },
      }),
      [Endpoints.fetchSharedAlbumsByMe]: builder.query<UserAlbumList, void>({
        query: () => "albums/user/shared/fromme/",
        transformResponse: response => UserAlbumListResponseSchema.parse(response).results,
      }),
      [Endpoints.fetchSharedAlbumsWithMe]: builder.query<UserAlbumsGroupedByUserId[], void>({
        query: () => "albums/user/shared/tome/",
        transformResponse: response => {
          const result = UserAlbumListResponseSchema.parse(response).results;
          return _.toPairs(_.groupBy(result, "owner.id")).map(el => ({
            user_id: parseInt(el[0], 10),
            albums: el[1],
          })) as unknown as UserAlbumsGroupedByUserId[];
        },
      }),
    }),
  })
  .enhanceEndpoints<"UserAlbums" | "UserAlbum" | "SharedAlbumsByMe" | "SharedAlbumsWithMe">({
    addTagTypes: ["UserAlbums", "UserAlbum", "SharedAlbumsByMe", "SharedAlbumsWithMe"],
    endpoints: {
      [Endpoints.shareUserAlbum]: {
        // TODO(sickelap): invalidate only the album that was shared
        invalidatesTags: ["UserAlbums", "UserAlbum", "SharedAlbumsByMe"],
      },
      [Endpoints.fetchSharedAlbumsByMe]: {
        providesTags: ["SharedAlbumsByMe"],
      },
      [Endpoints.fetchSharedAlbumsWithMe]: {
        providesTags: ["SharedAlbumsWithMe"],
      },
    },
  });

export const { useShareUserAlbumMutation, useFetchSharedAlbumsByMeQuery, useFetchSharedAlbumsWithMeQuery } =
  sharedUserAlbumsApi;
