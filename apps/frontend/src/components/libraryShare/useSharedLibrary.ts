import { Photoset } from "@librephotos/api-client";
import { useDateAlbumDayPages, useFetchDateAlbumsQuery } from "../../api_client/albums/hooks";
import { useListFailure } from "../common/useListFailure";
import { useGroupedPhotos } from "../photolist/useGroupedPhotos";
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
  const { groups, photosFlat } = useGroupedPhotos(photosQuery.data);

  // Pig reports the day groups on screen; their placeholders name the pages still to load.
  const updateGroups = useDateAlbumDayPages(
    { photosetType: Photoset.NONE, library: ownerId },
    { skip: share === undefined }
  );

  return {
    share,
    loadingShares: loading,
    groups,
    photosFlat,
    loadingPhotos: photosQuery.isLoading,
    failure,
    updateGroups,
  };
}
