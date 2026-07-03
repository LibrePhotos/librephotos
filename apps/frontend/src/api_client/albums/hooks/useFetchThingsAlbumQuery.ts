import { useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { mediaTypeToParams, type MediaType } from "../../../components/photolist/mediaTypeFilter";
import { parseWithNotification } from "../../../util/zodUtils";
import { fetchClient } from "../../api";
import { DatePhotosGroup } from "../../photos/types";

const ThingsAlbum = z.object({
  id: z.string(),
  title: z.string(),
  grouped_photos: DatePhotosGroup.array(),
});

export type ThingsAlbum = z.infer<typeof ThingsAlbum>;

const ThingsAlbumResponse = z.object({
  results: ThingsAlbum,
});

export const ThingsAlbumQueryKeys = ["thingsAlbum"] as const;

export const useFetchThingsAlbumQuery = (id: string, mediaType?: MediaType) =>
  useQuery({
    queryKey: [...ThingsAlbumQueryKeys, id, mediaType ?? "all"],
    queryFn: async () => {
      const query = new URLSearchParams(mediaTypeToParams(mediaType));
      const suffix = query.toString() ? `?${query.toString()}` : "";
      const response = await fetchClient.get(`/albums/thing/${id}/${suffix}`);
      return parseWithNotification(ThingsAlbumResponse, response, "Failed to parse things album").results;
    },
    enabled: !!id,
  });
