import { endpoints, tagKeys } from "@librephotos/api-client";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "../../api";

export const useFetchTagsQuery = () =>
  useQuery({
    queryKey: tagKeys.list(),
    queryFn: () => endpoints.fetchTagAlbumsList(apiClient),
  });

/** The tags attached to a single photo. Accepts a photo id or an image hash. */
export const useFetchPhotoTagsQuery = (photoId: string) =>
  useQuery({
    queryKey: tagKeys.photo(photoId),
    queryFn: () => endpoints.fetchPhotoTags(apiClient, photoId),
    enabled: !!photoId,
  });
