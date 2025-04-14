import { useQuery, useQueryClient } from '@tanstack/react-query';

import { fetchClient, QueryKeys } from "../../api";
import { AutoAlbum } from "../types";

export const useLazyFetchAutoAlbumQuery = () => {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: [QueryKeys.autoAlbum],
    queryFn: () => Promise.resolve(undefined),
    enabled: false
  });

  const fetch = (id: string) => {
    return fetchClient.get<AutoAlbum>(`/albums/auto/${id}/`)
      .then(response => {
        const data = AutoAlbum.parse(response);
        queryClient.setQueryData([QueryKeys.autoAlbum, id], data);
        return data;
      });
  };

  return [fetch, query] as const;
}; 