import { useQuery } from '@tanstack/react-query';
import { z } from "zod";

import { fetchClient, QueryKeys } from "../../api";
import { UserAlbumListResponseSchema } from "../types";

export const useFetchUserAlbumsQuery = () => useQuery({
  queryKey: [QueryKeys.userAlbums],
  queryFn: async () => {
    const response = await fetchClient.get('/albums/user/list/');
    return UserAlbumListResponseSchema.parse(response).results;
  },
}); 