import { useQuery } from '@tanstack/react-query';

import { fetchClient, QueryKeys } from "../../api";
import { AutoAlbum } from "../types";

export const useFetchAutoAlbumQuery = (id: string) => 
  useQuery({
    queryKey: [QueryKeys.autoAlbum, id],
    queryFn: () => fetchClient.get<AutoAlbum>(`/albums/auto/${id}/`)
      .then(response => AutoAlbum.parse(response)),
    enabled: !!id
  }); 