import { useQuery } from "@tanstack/react-query";
import { parseWithNotification } from "../../../util/zodUtils";
import { fetchClient } from "../../api";
import { TagListResponse } from "../types";

export const TagsQueryKeys = ["tags"] as const;

export const useFetchTagsQuery = () =>
  useQuery({
    queryKey: [...TagsQueryKeys],
    queryFn: async () => {
      const response = await fetchClient.get("/tags/");
      return parseWithNotification(TagListResponse, response, "Failed to parse tags").results;
    },
  });

/** The tags attached to a single photo. Accepts a photo id or an image hash. */
export const useFetchPhotoTagsQuery = (photoId: string) =>
  useQuery({
    queryKey: [...TagsQueryKeys, "photo", photoId],
    queryFn: async () => {
      const response = await fetchClient.get(`/tags/?photo=${encodeURIComponent(photoId)}`);
      return parseWithNotification(TagListResponse, response, "Failed to parse photo tags").results;
    },
    enabled: !!photoId,
  });
