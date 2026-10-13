import type { MediaType } from "@librephotos/api-client";
import { endpoints, photoGridKeys } from "@librephotos/api-client";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { mediaTypeToBulkQuery } from "../../../components/photolist/mediaTypeFilter";
import { apiClient } from "../../api";

// One page of the photos without a timestamp, narrowed by the page's media filter
export const useFetchPhotosWithoutTimestampQuery = (page: number, mediaType: MediaType = "all") =>
  useQuery({
    queryKey: photoGridKeys.withoutTimestamp(page, mediaType),
    queryFn: () => endpoints.fetchPhotosWithoutTimestamp(apiClient, page, mediaTypeToBulkQuery(mediaType)),
    placeholderData: keepPreviousData,
  });
