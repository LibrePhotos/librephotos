import { endpoints, type ThingAlbumInfo } from "@librephotos/api-client";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "../../api";

export const ThingsAlbumsQueryKeys = ["thingsAlbums"] as const;

export type ThingsAlbumList = ThingAlbumInfo[];

export const useFetchThingsAlbumsQuery = (skip: boolean = false) =>
  useQuery({
    queryKey: [...ThingsAlbumsQueryKeys],
    queryFn: () => endpoints.fetchThingAlbumsList(apiClient),
    enabled: !skip,
  });
