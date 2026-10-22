import type { PigPhoto } from "@librephotos/api-client";
import { Photoset } from "@librephotos/api-client";
import { useEffect, useState } from "react";
import { useFetchDateAlbumQuery, useFetchDateAlbumsQuery } from "../../api_client/albums/hooks";
import { getPhotosFlatFromGroupedByDate } from "../../util/util";
import { useListFailure } from "../common/useListFailure";
import { NO_PHOTO_GROUP, type PhotoGroup } from "../photolist/photoGroup";
import type { PigVisibleGroup } from "../photolist/PhotoListView";
import { useLibraryShares } from "./useLibraryShares";

/**
 * A library shared with me (#2731), as the library page lists it: the share (undefined when the
 * owner does not share with me) and its days, read like the timeline reads mine.
 */
export function useSharedLibrary(ownerId: number) {
  const { received, loading } = useLibraryShares();
  const share = received.find(row => row.owner.id === ownerId);
  const photosQuery = useFetchDateAlbumsQuery(
    { photosetType: Photoset.NONE, library: ownerId },
    { skip: share === undefined }
  );
  const failure = useListFailure(photosQuery);
  const [photosFlat, setPhotosFlat] = useState<PigPhoto[]>([]);
  useEffect(() => {
    if (photosQuery.data) setPhotosFlat(getPhotosFlatFromGroupedByDate(photosQuery.data));
  }, [photosQuery.data]);

  const [group, setGroup] = useState<PhotoGroup>(NO_PHOTO_GROUP);
  useFetchDateAlbumQuery(
    { album_date_id: group.id, page: group.page, photosetType: Photoset.NONE, library: ownerId },
    { skip: !group.id || share === undefined }
  );
  // Pig reports the day groups on screen; a group's first placeholder names the page to load.
  const updateGroups = (visibleGroups: PigVisibleGroup<PigPhoto>[]) => {
    visibleGroups.reverse().forEach(photoGroup => {
      const firstTempObject = photoGroup.items.find(i => i.isTemp);
      if (firstTempObject) {
        setGroup({ id: photoGroup.id, page: Math.ceil((parseInt(firstTempObject.id, 10) + 1) / 100) });
      }
    });
  };

  return {
    share,
    loadingShares: loading,
    groups: photosQuery.data ?? [],
    photosFlat,
    loadingPhotos: photosQuery.isLoading,
    failure,
    updateGroups,
  };
}
