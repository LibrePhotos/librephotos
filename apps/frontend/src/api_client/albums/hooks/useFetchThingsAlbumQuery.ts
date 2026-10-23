import { endpoints, photoGridKeys } from "@librephotos/api-client";
import type { MediaType, ThingAlbum } from "@librephotos/api-client";
import { useQuery } from "@tanstack/react-query";
import { mediaTypeToBulkQuery } from "../../../components/photolist/mediaTypeFilter";
import { withOrderedGroups } from "../../../util/photoOrder";
import { apiClient } from "../../api";
import { usePhotoOrderSelect } from "../../user/hooks/usePhotoOrder";

// The thing's days in the user's photo order (#2712).
export const useFetchThingsAlbumQuery = (id: string, mediaType?: MediaType) => {
  const { select, ready } = usePhotoOrderSelect<ThingAlbum>(withOrderedGroups);
  return useQuery({
    queryKey: photoGridKeys.thingsAlbum(id, mediaType ?? "all"),
    queryFn: () => endpoints.fetchThingAlbum(apiClient, id, mediaTypeToBulkQuery(mediaType)),
    enabled: !!id && ready,
    select,
  });
};
