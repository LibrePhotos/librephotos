import { fetchAllPages } from "@librephotos/api-client";
import { useQuery } from "@tanstack/react-query";
import { parseWithNotification } from "../../../util/zodUtils";
import { apiClient } from "../../api";
import { tagKeys } from "../keys";
import { TagListResponse } from "../types";

export const useFetchTagsQuery = () =>
  useQuery({
    queryKey: tagKeys.list(),
    queryFn: async () => {
      const results = await fetchAllPages(apiClient, "/tags/");
      return parseWithNotification(TagListResponse, { results }, "Failed to parse tags").results;
    },
  });

/** The tags attached to a single photo. Accepts a photo id or an image hash. */
export const useFetchPhotoTagsQuery = (photoId: string) =>
  useQuery({
    queryKey: tagKeys.photo(photoId),
    queryFn: async () => {
      const results = await fetchAllPages(apiClient, `/tags/?photo=${encodeURIComponent(photoId)}`);
      return parseWithNotification(TagListResponse, { results }, "Failed to parse photo tags").results;
    },
    enabled: !!photoId,
  });
