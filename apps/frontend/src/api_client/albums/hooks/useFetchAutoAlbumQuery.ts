import { useQuery } from '@tanstack/react-query';
import { fetchClient } from "../../api";
import { AutoAlbum } from "../types";

export const AutoAlbumQueryKeys = ['autoAlbum'] as const;

export const useFetchAutoAlbumQuery = (id: string) => 
  useQuery({
    queryKey: [...AutoAlbumQueryKeys, id],
    queryFn: () => fetchClient.get<AutoAlbum>(`/albums/auto/${id}/`)
      .then(response => AutoAlbum.parse(response)),
    enabled: !!id
  }); 