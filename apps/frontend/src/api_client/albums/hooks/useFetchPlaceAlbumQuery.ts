import { endpoints } from "@librephotos/api-client";
import { useQuery } from "@tanstack/react-query";
import { mediaTypeToBulkQuery, type MediaType } from "../../../components/photolist/mediaTypeFilter";
import { apiClient } from "../../api";
import { photoGridKeys } from "../../photos/keys";

export const useFetchPlaceAlbumQuery = (albumId: string, mediaType?: MediaType) =>
  useQuery({
    queryKey: photoGridKeys.placeAlbum(albumId, mediaType ?? "all"),
    queryFn: () => endpoints.fetchPlaceAlbum(apiClient, albumId, mediaTypeToBulkQuery(mediaType)),
    enabled: !!albumId,
  });
