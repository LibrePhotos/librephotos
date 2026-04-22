import { Box, Image, Loader } from "@mantine/core";
import React, { useMemo, useState } from "react";
import MapGL, { AttributionControl, Marker, NavigationControl, Popup } from "react-map-gl/maplibre";
import { getAveragedCoordinates } from "../util/util";

const MAP_STYLE = "https://cdn.photoprism.app/maps/default.json";

type Props = Readonly<{
  photos: any[];
}>;

export function LocationMap({ photos }: Props) {
  const height = "200px";
  const [popupInfo, setPopupInfo] = useState<any>(null);

  const photosWithGPS = useMemo(
    () => photos.filter(photo => photo.exif_gps_lon !== null && photo.exif_gps_lon),
    [photos]
  );
  const { avgLat, avgLon } = getAveragedCoordinates(photosWithGPS);

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

  if (photosWithGPS.length > 0) {
    return (
      <Box style={{ zIndex: 2, height, padding: 0 }}>
        <MapGL
          initialViewState={{
            longitude: avgLon,
            latitude: avgLat,
            zoom: 16,
          }}
          style={{ width: "100%", height }}
          mapStyle={MAP_STYLE}
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
                <Image src={popupInfo.square_thumbnail} />
              </div>
            </Popup>
          )}
        </MapGL>
      </Box>
    );
  }
  return (
    <Box style={{ height }}>
      <Loader>Map loading...</Loader>
    </Box>
  );
}
