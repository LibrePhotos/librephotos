import { endpoints } from "@librephotos/api-client";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "../../api";

const ThingsAlbumsQueryKeys = ["thingsAlbums"] as const;

export const useFetchThingsAlbumsQuery = (skip: boolean = false) =>
  useQuery({
    queryKey: [...ThingsAlbumsQueryKeys],
    queryFn: () => endpoints.fetchThingAlbumsList(apiClient),
    enabled: !skip,
  });
