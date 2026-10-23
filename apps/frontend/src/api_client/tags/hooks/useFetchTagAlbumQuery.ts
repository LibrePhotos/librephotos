import { endpoints, photoGridKeys } from "@librephotos/api-client";
import type { MediaType, TagAlbum } from "@librephotos/api-client";
import { useQuery } from "@tanstack/react-query";
import { mediaTypeToBulkQuery } from "../../../components/photolist/mediaTypeFilter";
import { withOrderedGroups } from "../../../util/photoOrder";
import { apiClient } from "../../api";
import { usePhotoOrderSelect } from "../../user/hooks/usePhotoOrder";

// The tag's days in the user's photo order (#2712).
export const useFetchTagAlbumQuery = (id: string, mediaType?: MediaType) => {
  const { select, ready } = usePhotoOrderSelect<TagAlbum>(withOrderedGroups);
  return useQuery({
    queryKey: photoGridKeys.tagAlbumView(id, mediaType ?? "all"),
    queryFn: () => endpoints.fetchTagAlbum(apiClient, id, mediaTypeToBulkQuery(mediaType)),
    enabled: !!id && ready,
    select,
  });
};
