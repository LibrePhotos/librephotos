import { endpoints, photoGridKeys } from "@librephotos/api-client";
import type { MediaType } from "@librephotos/api-client";
import { useQuery } from "@tanstack/react-query";
import { mediaTypeToBulkQuery } from "../../../components/photolist/mediaTypeFilter";
import { apiClient } from "../../api";

export const useFetchPlaceAlbumQuery = (albumId: string, mediaType?: MediaType) =>
  useQuery({
    queryKey: photoGridKeys.placeAlbum(albumId, mediaType ?? "all"),
    queryFn: () => endpoints.fetchPlaceAlbum(apiClient, albumId, mediaTypeToBulkQuery(mediaType)),
    enabled: !!albumId,
  });
