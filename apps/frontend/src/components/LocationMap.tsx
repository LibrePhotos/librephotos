import type { Photo } from "@librephotos/api-client";
import { Box } from "@mantine/core";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { AttributionControl, Marker, NavigationControl, Popup } from "react-map-gl/maplibre";
import type { MapRef } from "react-map-gl/maplibre";
import { useMapStyle } from "../util/mapStyle";
import { getAveragedCoordinates } from "../util/util";
import { MediaThumbnail } from "./common/MediaThumbnail";
import classes from "./LocationMap.module.css";
import { MapDisabledPlaceholder } from "./map/MapDisabledPlaceholder";
import { ignoreMissingStyleImages } from "./map/mapImages";
import { ThemedMap } from "./map/ThemedMap";

type MappablePhoto = Readonly<Pick<Photo, "image_hash" | "exif_gps_lat" | "exif_gps_lon">>;
type LocatedPhoto = MappablePhoto & Readonly<{ exif_gps_lat: number; exif_gps_lon: number }>;

const isLocated = (photo: MappablePhoto): photo is LocatedPhoto =>
  photo.exif_gps_lat !== null && photo.exif_gps_lon !== null && photo.exif_gps_lon !== 0;

type Props = Readonly<{
  photos: readonly MappablePhoto[];
}>;

// Street level: the map shows where one photo was taken
const PHOTO_ZOOM = 16;
// Fits maplibre's popup, which is at most 240px wide with its padding.
const POPUP_THUMBNAIL_SIZE = 200;

export function LocationMap({ photos }: Props) {
  const { t } = useTranslation();
  const height = "200px";
  const [popupInfo, setPopupInfo] = useState<LocatedPhoto | null>(null);
  // Null while map display is turned off
  const { mapStyle } = useMapStyle();

  const photosWithGPS = useMemo(() => photos.filter(isLocated), [photos]);
  const { avgLat, avgLon } = getAveragedCoordinates(photosWithGPS);

  // Hidden until the first tiles are drawn: between the style's load and the tiles the map was an
  // empty box with a lone pin and its attribution.
  const [drawn, setDrawn] = useState(false);
  const reveal = useCallback(() => setDrawn(true), []);

  const mapRef = useRef<MapRef | null>(null);
  const setMapRef = useCallback((ref: MapRef | null) => {
    mapRef.current = ref;
    ignoreMissingStyleImages(ref);
  }, []);
  // The map reads initialViewState only when it mounts: follow new coordinates and drop the
  // old popup, so a caller stepping through photos need not remount it (a remount rebuilds
  // the WebGL map and reloads its style and tiles, a blank flash per photo). The view is
  // reset too, so each photo opens at street level like a fresh map, not at the zoom or
  // rotation the user left on the previous one.
  useEffect(() => {
    mapRef.current?.jumpTo({ center: [avgLon, avgLat], zoom: PHOTO_ZOOM, bearing: 0, pitch: 0 });
    setPopupInfo(null);
  }, [avgLat, avgLon]);

  const markers = useMemo(
    () =>
      photosWithGPS.map(photo => (
        <Marker
          key={photo.image_hash}
          longitude={photo.exif_gps_lon}
          latitude={photo.exif_gps_lat}
          anchor="center"
          onClick={e => {
            e.originalEvent.stopPropagation();
            setPopupInfo(photo);
          }}
        >
          {/* HTML over the map, which the dark map filter leaves alone (LocationMap.module.css) */}
          <span className={classes.pin} />
        </Marker>
      )),
    [photosWithGPS]
  );

  if (photosWithGPS.length > 0 && mapStyle === null) {
    return <MapDisabledPlaceholder height={height} />;
  }

  if (photosWithGPS.length > 0 && mapStyle !== null) {
    return (
      <Box className={classes.frame} data-drawn={drawn || undefined}>
        <ThemedMap
          ref={setMapRef}
          h={height}
          initialViewState={{
            longitude: avgLon,
            latitude: avgLat,
            zoom: PHOTO_ZOOM,
          }}
          mapStyle={mapStyle}
          attributionControl={false}
          // "idle": the style and the tiles in view are drawn (or failed), nothing left to load.
          onLoad={event => event.target.once("idle", reveal)}
          onError={event => {
            reveal();
            console.error(event.error);
          }}
        >
          {/* Zoom only: a compass on a 200px tile was mostly clutter */}
          <NavigationControl position="top-right" showCompass={false} />
          <AttributionControl compact={true} />
          {markers}
          {popupInfo && (
            <Popup
              longitude={popupInfo.exif_gps_lon}
              latitude={popupInfo.exif_gps_lat}
              anchor="top"
              onClose={() => setPopupInfo(null)}
            >
              <div>
                <MediaThumbnail
                  imageHash={popupInfo.image_hash}
                  cover
                  size={POPUP_THUMBNAIL_SIZE}
                  alt={t("map.photohere")}
                />
              </div>
            </Popup>
          )}
        </ThemedMap>
      </Box>
    );
  }
  // Without coordinates there is nothing to load: this used to read "Map loading..." for good
  return null;
}
