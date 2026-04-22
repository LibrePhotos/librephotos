import { useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { parseWithNotification } from "../../../util/zodUtils";
import { fetchClient } from "../../api";
import { DatePhotosGroup } from "../../photos/types";

export const PlaceAlbumQueryKeys = ["placeAlbum"] as const;

const PlaceAlbum = z.object({
  id: z.string(),
  title: z.string(),
  grouped_photos: DatePhotosGroup.array(),
});

export type PlaceAlbum = z.infer<typeof PlaceAlbum>;

const PlaceAlbumResponse = z.object({ results: PlaceAlbum });

export const useFetchPlaceAlbumQuery = (albumId: string) =>
  useQuery({
    queryKey: [...PlaceAlbumQueryKeys, albumId],
    queryFn: async () => {
      const response = await fetchClient.get(`/albums/place/${albumId}/`);
      return parseWithNotification(PlaceAlbumResponse, response, "Failed to parse place album").results;
    },
    enabled: !!albumId,
  });
