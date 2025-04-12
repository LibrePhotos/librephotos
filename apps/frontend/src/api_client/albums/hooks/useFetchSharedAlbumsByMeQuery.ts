import { useQuery } from '@tanstack/react-query';
import { z } from "zod";

import { fetchClient, QueryKeys } from "../../api";
import { UserAlbumListResponseSchema } from "../types";

export const useFetchSharedAlbumsByMeQuery = () => useQuery({
  queryKey: [QueryKeys.sharedAlbumsByMe],
  queryFn: async () => {
    const response = await fetchClient.get('/albums/user/shared/fromme/');
    return UserAlbumListResponseSchema.parse(response).results;
  },
}); 