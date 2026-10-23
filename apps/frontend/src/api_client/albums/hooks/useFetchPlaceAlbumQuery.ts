import { endpoints, photoGridKeys } from "@librephotos/api-client";
import type { MediaType, PlaceAlbum } from "@librephotos/api-client";
import { useQuery } from "@tanstack/react-query";
import { mediaTypeToBulkQuery } from "../../../components/photolist/mediaTypeFilter";
import { withOrderedGroups } from "../../../util/photoOrder";
import { apiClient } from "../../api";
import { usePhotoOrderSelect } from "../../user/hooks/usePhotoOrder";

// The place's days in the user's photo order (#2712).
export const useFetchPlaceAlbumQuery = (albumId: string, mediaType?: MediaType) => {
  const { select, ready } = usePhotoOrderSelect<PlaceAlbum>(withOrderedGroups);
  return useQuery({
    queryKey: photoGridKeys.placeAlbum(albumId, mediaType ?? "all"),
    queryFn: () => endpoints.fetchPlaceAlbum(apiClient, albumId, mediaTypeToBulkQuery(mediaType)),
    enabled: !!albumId && ready,
    select,
  });
};
