import { albumKeys, endpoints } from "@librephotos/api-client";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "../../api";

export const useFetchThingsAlbumsQuery = (skip: boolean = false) =>
  useQuery({
    queryKey: albumKeys.thingsAlbums(),
    queryFn: () => endpoints.fetchThingAlbumsList(apiClient),
    enabled: !skip,
  });
