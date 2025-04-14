  import { useQuery } from '@tanstack/react-query';

import { fetchClient } from "../../api";
import { UserAlbumListResponse } from "../types";

export const SharedAlbumsByMeQueryKeys = ['sharedAlbumsByMe'] as const;

export const useFetchSharedAlbumsByMeQuery = () => useQuery({
  queryKey: [...SharedAlbumsByMeQueryKeys],
  queryFn: async () => {
    const response = await fetchClient.get('/albums/user/shared/fromme/');
    return UserAlbumListResponse.parse(response).results;
  },
}); 