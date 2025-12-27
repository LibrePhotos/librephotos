import { useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { parseWithNotification } from "../../../util/zodUtils";
import { fetchClient } from "../../api";
import { PhotoHash } from "../../photos/types";

const ThingsAlbumList = z
  .object({
    id: z.number(),
    title: z.string(),
    cover_photos: PhotoHash.array(),
    photo_count: z.number(),
    thing_type: z.string(),
  })
  .array();

const ThingsAlbumListResponse = z.object({
  results: ThingsAlbumList,
});

export const ThingsAlbumsQueryKeys = ["thingsAlbums"] as const;

export type ThingsAlbumList = z.infer<typeof ThingsAlbumList>;

export const useFetchThingsAlbumsQuery = () =>
  useQuery({
    queryKey: [...ThingsAlbumsQueryKeys],
    queryFn: async () => {
      const response = await fetchClient.get("/albums/thing/list/");
      return parseWithNotification(ThingsAlbumListResponse, response, "Failed to parse things albums").results;
    },
  });
