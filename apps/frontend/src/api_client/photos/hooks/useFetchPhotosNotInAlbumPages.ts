import type { MediaType } from "@librephotos/api-client";
import { endpoints, photoGridKeys } from "@librephotos/api-client";
import { mediaTypeToBulkQuery } from "../../../components/photolist/mediaTypeFilter";
import { apiClient } from "../../api";
import { usePhotoPages } from "./usePhotoPages";

// The pages asked for so far of the photos in none of my albums, narrowed by the page's media filter
export const useFetchPhotosNotInAlbumPages = (pages: readonly number[], mediaType: MediaType = "all") =>
  usePhotoPages(pages, page => ({
    queryKey: photoGridKeys.notInAlbum(page, mediaType),
    queryFn: () => endpoints.fetchPhotosNotInAlbum(apiClient, page, mediaTypeToBulkQuery(mediaType)),
  }));
