import { albumKeys, endpoints, photoGridKeys, type MapBounds } from "@librephotos/api-client";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { apiClient } from "../../api";

/** Where my photos were taken, for the Places map (#343). */
export const useFetchPhotoMapPointsQuery = () =>
  useQuery({
    queryKey: albumKeys.mapPoints(),
    queryFn: () => endpoints.fetchPhotoMapPoints(apiClient),
  });

const NO_BOUNDS: MapBounds = { south: 0, west: 0, north: 0, east: 0 };

/**
 * The ids of my place albums with a photo inside `bounds`; off until the map has reported a view.
 * The ids of the last view stay while the next one loads, so the grid does not empty on every pan.
 */
export const usePlaceAlbumsInBoundsQuery = (bounds: MapBounds | null) =>
  useQuery({
    queryKey: albumKeys.placesInBounds(bounds ?? NO_BOUNDS),
    queryFn: () => endpoints.fetchPlaceAlbumsInBounds(apiClient, bounds ?? NO_BOUNDS),
    enabled: bounds !== null,
    placeholderData: keepPreviousData,
  });

/** My photos taken inside `bounds`, newest first: what a point of the Places map opens. */
export const usePhotosInBoundsQuery = (bounds: MapBounds | null) =>
  useQuery({
    queryKey: photoGridKeys.inBounds(bounds ?? NO_BOUNDS),
    queryFn: () => endpoints.fetchPhotosInBounds(apiClient, bounds ?? NO_BOUNDS),
    enabled: bounds !== null,
  });
