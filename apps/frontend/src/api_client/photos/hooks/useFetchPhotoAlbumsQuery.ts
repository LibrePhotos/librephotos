import { useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { parseWithNotification } from "../../../util/zodUtils";
import { UserAlbumInfo } from "../../albums/types";
import { apiClient } from "../../api";
import { photoKeys } from "../keys";

const PhotoAlbumsResponse = z.object({
  results: UserAlbumInfo.array(),
});

export const useFetchPhotoAlbumsQuery = (hash: string) =>
  useQuery({
    queryKey: photoKeys.albums(hash),
    queryFn: async () => {
      if (!hash) {
        return [];
      }
      const response = await apiClient.get(`/photos/${hash}/albums/`);
      return parseWithNotification(PhotoAlbumsResponse, response, "Failed to parse photo albums").results;
    },
    enabled: Boolean(hash),
  });
