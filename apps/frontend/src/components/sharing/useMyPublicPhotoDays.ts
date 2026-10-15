import type { PigPhoto } from "@librephotos/api-client";
import { Photoset } from "@librephotos/api-client";
import { useCallback, useMemo, useState } from "react";
import { DATE_ALBUM_PAGE_SIZE, useFetchDateAlbumQuery, useFetchDateAlbumsQuery } from "../../api_client/albums/hooks";
import { useCurrentUserSelfDetailsQuery } from "../../api_client/user/hooks";
import { getPhotosFlatFromGroupedByDate } from "../../util/util";
import { NO_PHOTO_GROUP } from "../photolist/photoGroup";
import type { PigVisibleGroup } from "../photolist/PhotoListView";

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

  const [group, setGroup] = useState(NO_PHOTO_GROUP);
  useFetchDateAlbumQuery(
    { album_date_id: group.id, page: group.page, photosetType: Photoset.PUBLIC, username },
    { skip: !group.id || username === undefined }
  );

  // The first placeholder of each visible day names the page to load.
  const updateGroups = useCallback((visibleGroups: PigVisibleGroup<PigPhoto>[]) => {
    [...visibleGroups].reverse().forEach(day => {
      const placeholder = day.items.find(item => item.isTemp);
      if (placeholder !== undefined) {
        setGroup({ id: day.id, page: Math.ceil((parseInt(placeholder.id, 10) + 1) / DATE_ALBUM_PAGE_SIZE) });
      }
    });
  }, []);

  return { days, photosFlat, count, isLoading: isLoading || username === undefined, updateGroups };
}
