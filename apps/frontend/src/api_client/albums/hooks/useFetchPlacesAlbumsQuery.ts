import { endpoints, type PlaceAlbumInfo } from "@librephotos/api-client";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "../../api";

export const PlacesAlbumsQueryKeys = ["placesAlbums"] as const;

export type PlaceAlbumList = PlaceAlbumInfo[];

export const useFetchPlacesAlbumsQuery = (skip: boolean = false) =>
  useQuery({
    queryKey: [...PlacesAlbumsQueryKeys],
    queryFn: () => endpoints.fetchPlaceAlbumsList(apiClient),
    enabled: !skip,
  });
