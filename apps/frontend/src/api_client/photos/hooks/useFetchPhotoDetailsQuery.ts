import { useQuery } from '@tanstack/react-query';

import type { Photo } from "../types";
import { fetchClient, QueryKeys } from "../../api";

export const useFetchPhotoDetailsQuery = (hash: string) => useQuery({
  queryKey: [QueryKeys.autoAlbum, hash],
  queryFn: async () => {
    const response = await fetchClient.get(`/photos/${hash}/`);
    return response as Photo;
  },
}); 