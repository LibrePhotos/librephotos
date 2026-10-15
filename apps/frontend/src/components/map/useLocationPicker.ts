import type { ParseKeys } from "i18next";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { MapLayerMouseEvent, MapRef, MarkerDragEvent } from "react-map-gl/maplibre";
import { ignoreMissingStyleImages } from "./mapImages";
import type { PositionedPhoto } from "./NearbyLocatedStrip";

// Why the browser could not tell where the user is, by GeolocationPositionError code:
// PERMISSION_DENIED, POSITION_UNAVAILABLE and TIMEOUT.
const GEOLOCATION_ERROR_KEYS: Partial<Record<number, ParseKeys>> = {
  1: "locationpicker.permission_denied",
  2: "locationpicker.position_unavailable",
  3: "locationpicker.timeout",
};

export const PLACE_ZOOM = 13;
// Where a photo without a location starts when a photo taken near it in time has one (#2279).
const NEARBY_ZOOM = 10;

type Position = [number, number];

/** A position whose place name the server already has: the photo's own, or a copied photo's. */
type KnownPlace = Readonly<{ position: Position; name: string }>;

function samePosition(a: readonly [number, number] | null, b: readonly [number, number] | null): boolean {
  return a !== null && b !== null && a[0] === b[0] && a[1] === b[1];
}

/**
 * The state of the location picker, single photo or many: the picked position, the map it is shown
 * on, the place name already known for it, and "use my location".
 */
export function useLocationPicker(initialPosition: Position | null, initialPlace?: string) {
  const { t } = useTranslation();
  const mapRef = useRef<MapRef | null>(null);
  const setMapRef = useCallback((map: MapRef | null) => {
    mapRef.current = map;
    ignoreMissingStyleImages(map);
  }, []);
  const [position, setPosition] = useState<Position | null>(initialPosition);
  const [known, setKnown] = useState<KnownPlace | null>(() =>
    initialPosition && initialPlace ? { position: initialPosition, name: initialPlace } : null
  );
  const [isGeolocating, setIsGeolocating] = useState(false);
  const [geolocationError, setGeolocationError] = useState<string | null>(null);

  const onMapClick = useCallback((e: MapLayerMouseEvent) => setPosition([e.lngLat.lat, e.lngLat.lng]), []);
  const onMarkerDragEnd = useCallback((e: MarkerDragEvent) => setPosition([e.lngLat.lat, e.lngLat.lng]), []);

  // Pan to a picked spot: the map's first view is the photo's location or the world.
  const pick = useCallback((lat: number, lon: number) => {
    setPosition([lat, lon]);
    mapRef.current?.flyTo({ center: [lon, lat], zoom: PLACE_ZOOM });
  }, []);

  const pickPhoto = useCallback(
    (photo: PositionedPhoto) => {
      pick(photo.exif_gps_lat, photo.exif_gps_lon);
      if (photo.place) setKnown({ position: [photo.exif_gps_lat, photo.exif_gps_lon], name: photo.place });
    },
    [pick]
  );

  // The only place that asks the browser for the user's position: never on open (#2283).
  const useMyLocation = useCallback(() => {
    if (!navigator.geolocation) {
      setGeolocationError(t("locationpicker.geolocation_not_supported"));
      return;
    }
    setIsGeolocating(true);
    setGeolocationError(null);
    navigator.geolocation.getCurrentPosition(
      pos => {
        setIsGeolocating(false);
        pick(pos.coords.latitude, pos.coords.longitude);
      },
      error => {
        setIsGeolocating(false);
        setGeolocationError(t(GEOLOCATION_ERROR_KEYS[error.code] ?? "locationpicker.unknown_error"));
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
  }, [t, pick]);

  return {
    position,
    /** A spot other than the one the picker opened on is picked, and not saved yet. */
    changed: position !== null && !samePosition(position, initialPosition),
    knownPlace: known && samePosition(position, known.position) ? known.name : undefined,
    setMapRef,
    onMapClick,
    onMarkerDragEnd,
    pick,
    pickPhoto,
    useMyLocation,
    isGeolocating,
    geolocationError,
    /** Show the area of `photo` while nothing is picked yet: where photos taken around then were. */
    startNear: useCallback((photo: PositionedPhoto | undefined) => {
      if (photo) mapRef.current?.jumpTo({ center: [photo.exif_gps_lon, photo.exif_gps_lat], zoom: NEARBY_ZOOM });
    }, []),
  };
}

export type LocationPicker = ReturnType<typeof useLocationPicker>;

/**
 * Start the map at the nearest geotagged photo, once, when the picker opens without a position
 * (#2279; the world view stays when there is none).
 */
export function useStartNearNearest(picker: LocationPicker, nearest: PositionedPhoto | undefined) {
  const started = useRef(picker.position !== null);
  const { startNear } = picker;
  useEffect(() => {
    if (started.current || nearest === undefined) return;
    started.current = true;
    startNear(nearest);
  }, [nearest, startNear]);
}
