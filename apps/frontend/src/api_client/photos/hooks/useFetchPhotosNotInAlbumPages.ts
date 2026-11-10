import type { MediaType } from "@librephotos/api-client";
import { endpoints, photoGridKeys } from "@librephotos/api-client";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { mediaTypeToBulkQuery } from "../../../components/photolist/mediaTypeFilter";
import { apiClient } from "../../api";

// One page of the photos in none of my albums, narrowed by the page's media filter
export const useFetchPhotosNotInAlbumQuery = (page: number, mediaType: MediaType = "all") =>
  useQuery({
    queryKey: photoGridKeys.notInAlbum(page, mediaType),
    queryFn: () => endpoints.fetchPhotosNotInAlbum(apiClient, page, mediaTypeToBulkQuery(mediaType)),
    placeholderData: keepPreviousData,
  });
