import { useQuery } from '@tanstack/react-query';
import { z } from "zod";

import { fetchClient, QueryKeys } from "../../api";
import { UserAlbumSchema } from "../types";

export const useFetchUserAlbumQuery = (id: string) => useQuery({
  queryKey: [QueryKeys.userAlbum, id],
  queryFn: async () => {
    const response = await fetchClient.get(`/albums/user/${id}/`);
    return UserAlbumSchema.parse(response);
  },
}); 