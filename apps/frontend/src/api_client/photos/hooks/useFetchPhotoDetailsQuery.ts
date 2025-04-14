import { useQuery } from '@tanstack/react-query';

import type { Photo } from "../types";
import { fetchClient } from "../../api";

export const PhotoDetailsQueryKeys = ["photoDetails"] as const;

export const useFetchPhotoDetailsQuery = (hash: string) => useQuery({
  queryKey: [...PhotoDetailsQueryKeys, hash],
  queryFn: async () => {
    const response = await fetchClient.get(`/photos/${hash}/`);
    return response as Photo;
  },
}); 