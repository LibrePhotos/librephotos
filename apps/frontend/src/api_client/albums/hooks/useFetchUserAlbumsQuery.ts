import { useQuery } from '@tanstack/react-query';
import { z } from "zod";

import { fetchClient } from "../../api";
import { UserAlbumListResponse } from "../types";

export const UserAlbumsQueryKeys = ['userAlbums'] as const;

export const useFetchUserAlbumsQuery = () => useQuery({
  queryKey: [...UserAlbumsQueryKeys],
  queryFn: async () => {
    const response = await fetchClient.get('/albums/user/list/');
    return UserAlbumListResponse.parse(response).results;
  },
}); 