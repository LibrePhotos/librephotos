import { endpoints } from "@librephotos/api-client";
import { useQuery } from "@tanstack/react-query";
import { mediaTypeToBulkQuery, type MediaType } from "../../../components/photolist/mediaTypeFilter";
import { apiClient } from "../../api";
import { photoGridKeys } from "../../photos/keys";

export const useFetchThingsAlbumQuery = (id: string, mediaType?: MediaType) =>
  useQuery({
    queryKey: photoGridKeys.thingsAlbum(id, mediaType ?? "all"),
    queryFn: () => endpoints.fetchThingAlbum(apiClient, id, mediaTypeToBulkQuery(mediaType)),
    enabled: !!id,
  });
