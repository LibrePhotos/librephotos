import { endpoints } from "@librephotos/api-client";
import { useQuery } from "@tanstack/react-query";
import { mediaTypeToBulkQuery, type MediaType } from "../../../components/photolist/mediaTypeFilter";
import { apiClient } from "../../api";

export const ThingsAlbumQueryKeys = ["thingsAlbum"] as const;

export const useFetchThingsAlbumQuery = (id: string, mediaType?: MediaType) =>
  useQuery({
    queryKey: [...ThingsAlbumQueryKeys, id, mediaType ?? "all"],
    queryFn: () => endpoints.fetchThingAlbum(apiClient, id, mediaTypeToBulkQuery(mediaType)),
    enabled: !!id,
  });
