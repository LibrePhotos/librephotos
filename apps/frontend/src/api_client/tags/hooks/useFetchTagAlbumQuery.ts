import { endpoints } from "@librephotos/api-client";
import { useQuery } from "@tanstack/react-query";
import { mediaTypeToBulkQuery, type MediaType } from "../../../components/photolist/mediaTypeFilter";
import { apiClient } from "../../api";
import { photoGridKeys } from "../../photos/keys";

export const useFetchTagAlbumQuery = (id: string, mediaType?: MediaType) =>
  useQuery({
    queryKey: photoGridKeys.tagAlbumView(id, mediaType ?? "all"),
    queryFn: () => endpoints.fetchTagAlbum(apiClient, id, mediaTypeToBulkQuery(mediaType)),
    enabled: !!id,
  });
