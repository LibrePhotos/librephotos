import { endpoints, type PlaceAlbumInfo } from "@librephotos/api-client";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "../../api";
import { albumKeys } from "../keys";

export type PlaceAlbumList = PlaceAlbumInfo[];

export const useFetchPlacesAlbumsQuery = (skip: boolean = false) =>
  useQuery({
    queryKey: albumKeys.placesAlbums(),
    queryFn: () => endpoints.fetchPlaceAlbumsList(apiClient),
    enabled: !skip,
  });
