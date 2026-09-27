import { endpoints } from "@librephotos/api-client";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "../../api";

export const AutoAlbumsQueryKeys = ["autoAlbums"] as const;

export const useFetchAutoAlbumsQuery = () =>
  useQuery({
    queryKey: [...AutoAlbumsQueryKeys],
    queryFn: () => endpoints.fetchAutoAlbumsList(apiClient),
  });
