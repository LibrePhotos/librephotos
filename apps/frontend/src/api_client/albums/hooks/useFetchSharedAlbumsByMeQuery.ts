  import { useQuery } from '@tanstack/react-query';

import { fetchClient, QueryKeys } from "../../api";
import { UserAlbumListResponse } from "../types";

export const useFetchSharedAlbumsByMeQuery = () => useQuery({
  queryKey: [QueryKeys.sharedAlbumsByMe],
  queryFn: async () => {
    const response = await fetchClient.get('/albums/user/shared/fromme/');
    return UserAlbumListResponse.parse(response).results;
  },
}); 