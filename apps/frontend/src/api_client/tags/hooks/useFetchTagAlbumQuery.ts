import { useQuery } from "@tanstack/react-query";
import { mediaTypeToParams, type MediaType } from "../../../components/photolist/mediaTypeFilter";
import { parseWithNotification } from "../../../util/zodUtils";
import { fetchClient } from "../../api";
import { TagAlbumResponse } from "../types";

export const TagAlbumQueryKeys = ["tagAlbum"] as const;

export const useFetchTagAlbumQuery = (id: string, mediaType?: MediaType) =>
  useQuery({
    queryKey: [...TagAlbumQueryKeys, id, mediaType ?? "all"],
    queryFn: async () => {
      const query = new URLSearchParams(mediaTypeToParams(mediaType));
      const suffix = query.toString() ? `?${query.toString()}` : "";
      const response = await fetchClient.get(`/tags/${id}/${suffix}`);
      return parseWithNotification(TagAlbumResponse, response, "Failed to parse tag album").results;
    },
    enabled: !!id,
  });
