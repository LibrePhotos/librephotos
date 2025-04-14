import { useQuery } from '@tanstack/react-query';
import { z } from "zod";

import { fetchClient } from "../../api";
import { UserAlbum } from "../types";

export const UserAlbumQueryKeys = ['userAlbum'] as const;

export const useFetchUserAlbumQuery = (id: string) => useQuery({
  queryKey: [...UserAlbumQueryKeys, id],
  queryFn: async () => {
    const response = await fetchClient.get(`/albums/user/${id}/`);
    return UserAlbum.parse(response);
  },
}); 