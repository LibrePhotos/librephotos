import type { MediaType } from "@librephotos/api-client";
import { endpoints, photoGridKeys } from "@librephotos/api-client";
import { mediaTypeToBulkQuery } from "../../../components/photolist/mediaTypeFilter";
import { apiClient } from "../../api";
import { usePhotoPages } from "./usePhotoPages";

// The pages asked for so far of the photos without GPS coordinates, narrowed by the page's media filter
export const useFetchPhotosWithoutLocationPages = (pages: readonly number[], mediaType: MediaType = "all") =>
  usePhotoPages(pages, page => ({
    queryKey: photoGridKeys.withoutLocation(page, mediaType),
    queryFn: () => endpoints.fetchPhotosWithoutLocation(apiClient, page, mediaTypeToBulkQuery(mediaType)),
  }));
