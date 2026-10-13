import type { MediaType } from "@librephotos/api-client";
import { endpoints, photoGridKeys } from "@librephotos/api-client";
import { useQuery } from "@tanstack/react-query";
import { mediaTypeToBulkQuery } from "../../../components/photolist/mediaTypeFilter";
import { apiClient } from "../../api";

// The photos of the latest upload day, narrowed by the page's media filter
export const useFetchRecentlyAddedPhotosQuery = (mediaType: MediaType = "all") =>
  useQuery({
    queryKey: photoGridKeys.recentlyAddedView(mediaType),
    queryFn: () => endpoints.fetchRecentlyAddedPhotos(apiClient, mediaTypeToBulkQuery(mediaType)),
  });
