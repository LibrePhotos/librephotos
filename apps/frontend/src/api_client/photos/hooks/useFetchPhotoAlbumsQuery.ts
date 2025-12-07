import { useQuery } from '@tanstack/react-query';

import { UserAlbumInfo } from "../../albums/types";
import { fetchClient } from "../../api";
import { z } from "zod";

const PhotoAlbumsResponse = z.object({
  results: UserAlbumInfo.array(),
});

export const PhotoAlbumsQueryKeys = ["photoAlbums"] as const;

export const useFetchPhotoAlbumsQuery = (hash: string) => useQuery({
  queryKey: [...PhotoAlbumsQueryKeys, hash],
  queryFn: async () => {
    if (!hash) {
      return [];
    }
    const response = await fetchClient.get(`/photos/${hash}/albums/`);
    return PhotoAlbumsResponse.parse(response).results;
  },
  enabled: Boolean(hash),
});


