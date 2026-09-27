import { endpoints } from "@librephotos/api-client";
import { useQuery } from "@tanstack/react-query";
import { mediaTypeToBulkQuery, type MediaType } from "../../../components/photolist/mediaTypeFilter";
import { apiClient } from "../../api";

export type { PlaceAlbum } from "@librephotos/api-client";

export const PlaceAlbumQueryKeys = ["placeAlbum"] as const;

export const useFetchPlaceAlbumQuery = (albumId: string, mediaType?: MediaType) =>
  useQuery({
    queryKey: [...PlaceAlbumQueryKeys, albumId, mediaType ?? "all"],
    queryFn: () => endpoints.fetchPlaceAlbum(apiClient, albumId, mediaTypeToBulkQuery(mediaType)),
    enabled: !!albumId,
  });
