import type { MediaType } from "@librephotos/api-client";
import { endpoints, photoGridKeys } from "@librephotos/api-client";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { mediaTypeToBulkQuery } from "../../../components/photolist/mediaTypeFilter";
import { apiClient } from "../../api";

// One page of the photos without GPS coordinates, narrowed by the page's media filter
export const useFetchPhotosWithoutLocationQuery = (page: number, mediaType: MediaType = "all") =>
  useQuery({
    queryKey: photoGridKeys.withoutLocation(page, mediaType),
    queryFn: () => endpoints.fetchPhotosWithoutLocation(apiClient, page, mediaTypeToBulkQuery(mediaType)),
    placeholderData: keepPreviousData,
  });
