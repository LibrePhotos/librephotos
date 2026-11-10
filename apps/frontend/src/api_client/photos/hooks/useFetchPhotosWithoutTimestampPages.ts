import type { MediaType } from "@librephotos/api-client";
import { endpoints, photoGridKeys } from "@librephotos/api-client";
import { mediaTypeToBulkQuery } from "../../../components/photolist/mediaTypeFilter";
import { apiClient } from "../../api";
import { usePhotoPages } from "./usePhotoPages";

// The pages asked for so far of the photos without a timestamp, narrowed by the page's media filter
export const useFetchPhotosWithoutTimestampPages = (pages: readonly number[], mediaType: MediaType = "all") =>
  usePhotoPages(pages, page => ({
    queryKey: photoGridKeys.withoutTimestamp(page, mediaType),
    queryFn: () => endpoints.fetchPhotosWithoutTimestamp(apiClient, page, mediaTypeToBulkQuery(mediaType)),
  }));
