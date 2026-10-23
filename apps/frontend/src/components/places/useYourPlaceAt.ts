import type { UserPlace } from "@librephotos/api-client";
import { useMemo } from "react";
import { useUserPlacesQuery } from "../../api_client/albums/hooks/useUserPlaces";
import { placeAt } from "./placeGeometry";

/**
 * The owner's own place (#1365) a photo was taken in, for the owner's photo details: the smallest
 * that holds its position, as the server files it. Only the owner's views call it, with the
 * owner's places; a shared or public view never shows one.
 */
export function useYourPlaceAt(lat: number | null | undefined, lon: number | null | undefined): UserPlace | undefined {
  const { data: places } = useUserPlacesQuery();
  return useMemo(
    () => (places && lat != null && lon != null ? placeAt(places, { lat, lon }) : undefined),
    [places, lat, lon]
  );
}
