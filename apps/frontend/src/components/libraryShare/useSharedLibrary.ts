import type { PigPhoto } from "@librephotos/api-client";
import { Photoset } from "@librephotos/api-client";
import { useEffect, useState } from "react";
import { useDateAlbumDayPages, useFetchDateAlbumsQuery } from "../../api_client/albums/hooks";
import { getPhotosFlatFromGroupedByDate } from "../../util/util";
import { useListFailure } from "../common/useListFailure";
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

  // Pig reports the day groups on screen; their placeholders name the pages still to load.
  const updateGroups = useDateAlbumDayPages(
    { photosetType: Photoset.NONE, library: ownerId },
    { skip: share === undefined }
  );

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
