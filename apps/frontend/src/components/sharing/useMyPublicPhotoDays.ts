import { Photoset } from "@librephotos/api-client";
import { useMemo } from "react";
import { useDateAlbumDayPages, useFetchDateAlbumsQuery } from "../../api_client/albums/hooks";
import { useCurrentUserSelfDetailsQuery } from "../../api_client/user/hooks";
import { getPhotosFlatFromGroupedByDate } from "../../util/util";

/**
 * My public photos by day, for the Public Links page (#2686).
 *
 * Each day arrives as placeholders, so the count is the days' `numberOfItems`, and `updateGroups`
 * (the photo list's) loads a day's page when it scrolls into view. Only my photos: a public day
 * list without a username is every user's public photos.
 */
export function useMyPublicPhotoDays() {
  const { data: me } = useCurrentUserSelfDetailsQuery();
  const username = me?.username;
  const { data, isLoading } = useFetchDateAlbumsQuery(
    { photosetType: Photoset.PUBLIC, username },
    { skip: username === undefined }
  );
  const days = useMemo(() => data ?? [], [data]);
  const photosFlat = useMemo(() => getPhotosFlatFromGroupedByDate(days), [days]);
  const count = useMemo(() => days.reduce((sum, day) => sum + day.numberOfItems, 0), [days]);

  // The photo list reports the days on screen; their placeholders name the pages to load.
  const updateGroups = useDateAlbumDayPages(
    { photosetType: Photoset.PUBLIC, username },
    { skip: username === undefined }
  );

  return { days, photosFlat, count, isLoading: isLoading || username === undefined, updateGroups };
}
