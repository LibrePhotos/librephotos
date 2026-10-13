import { endpoints, photoGridKeys } from "@librephotos/api-client";
import type { MediaType } from "@librephotos/api-client";
import { useQuery } from "@tanstack/react-query";
import { mediaTypeToBulkQuery } from "../../../components/photolist/mediaTypeFilter";
import { apiClient } from "../../api";

export const useFetchTagAlbumQuery = (id: string, mediaType?: MediaType) =>
  useQuery({
    queryKey: photoGridKeys.tagAlbumView(id, mediaType ?? "all"),
    queryFn: () => endpoints.fetchTagAlbum(apiClient, id, mediaTypeToBulkQuery(mediaType)),
    enabled: !!id,
  });
