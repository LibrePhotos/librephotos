import { Box, Image } from "@mantine/core";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import MapGL, { AttributionControl, Marker, NavigationControl, Popup } from "react-map-gl/maplibre";
import type { MapRef } from "react-map-gl/maplibre";
import { serverAddress } from "../api_client/apiClient";
import type { Photo } from "../api_client/photos/types";
import { useMapStyle } from "../util/mapStyle";
import { getAveragedCoordinates } from "../util/util";
import { MapDisabledPlaceholder } from "./map/MapDisabledPlaceholder";
import { ignoreMissingStyleImages } from "./map/mapImages";

type MappablePhoto = Readonly<Pick<Photo, "image_hash" | "exif_gps_lat" | "exif_gps_lon">>;
type LocatedPhoto = MappablePhoto & Readonly<{ exif_gps_lat: number; exif_gps_lon: number }>;

const isLocated = (photo: MappablePhoto): photo is LocatedPhoto =>
  photo.exif_gps_lat !== null && photo.exif_gps_lon !== null && photo.exif_gps_lon !== 0;

type Props = Readonly<{
  photos: readonly MappablePhoto[];
}>;

// Street level: the map shows where one photo was taken
const PHOTO_ZOOM = 16;

export function LocationMap({ photos }: Props) {
  const height = "200px";
  const [popupInfo, setPopupInfo] = useState<LocatedPhoto | null>(null);
  // Null while map display is turned off
  const { mapStyle } = useMapStyle();

  const photosWithGPS = useMemo(() => photos.filter(isLocated), [photos]);
  const { avgLat, avgLon } = getAveragedCoordinates(photosWithGPS);

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
          anchor="bottom"
          onClick={e => {
            e.originalEvent.stopPropagation();
            setPopupInfo(photo);
          }}
        />
      )),
    [photosWithGPS]
  );

  if (photosWithGPS.length > 0 && mapStyle === null) {
    return <MapDisabledPlaceholder height={height} />;
  }

  if (photosWithGPS.length > 0 && mapStyle !== null) {
    return (
      <Box style={{ zIndex: 2, height, padding: 0 }}>
        <MapGL
          ref={setMapRef}
          initialViewState={{
            longitude: avgLon,
            latitude: avgLat,
            zoom: PHOTO_ZOOM,
          }}
          style={{ width: "100%", height }}
          mapStyle={mapStyle}
          attributionControl={false}
        >
          <NavigationControl position="top-right" />
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
                <Image src={`${serverAddress}/media/square_thumbnails/${popupInfo.image_hash}`} />
              </div>
            </Popup>
          )}
        </MapGL>
      </Box>
    );
  }
  // Without coordinates there is nothing to load: this used to read "Map loading..." for good
  return null;
}
