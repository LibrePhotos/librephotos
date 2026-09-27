import { endpoints } from "@librephotos/api-client";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "../../api";

export const AutoAlbumQueryKeys = ["autoAlbum"] as const;

export const useFetchAutoAlbumQuery = (id: string) =>
  useQuery({
    queryKey: [...AutoAlbumQueryKeys, id],
    queryFn: () => endpoints.fetchAutoAlbum(apiClient, id),
    enabled: !!id,
  });
