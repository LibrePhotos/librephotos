import React, { useMemo } from "react";
import MapGL, { AttributionControl, Marker, NavigationControl } from "react-map-gl/maplibre";

import { PartialPhotoWithLocation, getAveragedCoordinates } from "../util/util";

const MAP_STYLE = "https://cdn.photoprism.app/maps/default.json";

type Props = {
  photos: PartialPhotoWithLocation[];
};

export function AlbumLocationMap({ photos }: Readonly<Props>) {
  const photosWithGPS = useMemo(
    () => photos.filter(photo => photo.exif_gps_lon !== null && photo.exif_gps_lat !== null),
    [photos]
  );
  const { avgLat, avgLon } = getAveragedCoordinates(photosWithGPS);

  const markers = useMemo(
    () =>
      photosWithGPS.map(photo => (
        <Marker
          key={`marker-${photo.id}`}
          longitude={photo.exif_gps_lon!}
          latitude={photo.exif_gps_lat!}
          anchor="bottom"
        />
      )),
    [photosWithGPS]
  );

  if (photosWithGPS.length > 0) {
    return (
      <div style={{ padding: 0 }}>
        <MapGL
          initialViewState={{
            longitude: avgLon,
            latitude: avgLat,
            zoom: 6,
          }}
          style={{ width: "100%", height: "300px" }}
          mapStyle={MAP_STYLE}
          attributionControl={false}
        >
          <NavigationControl position="top-right" />
          <AttributionControl compact={true} />
          {markers}
        </MapGL>
      </div>
    );
  }
  return <div />;
}
