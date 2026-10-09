import React, { useMemo } from "react";
import MapGL, { AttributionControl, Marker, NavigationControl } from "react-map-gl/maplibre";
import { useMapStyle } from "../util/mapStyle";
import { getAveragedCoordinates, PartialPhotoWithLocation } from "../util/util";
import { MapDisabledPlaceholder } from "./map/MapDisabledPlaceholder";
import { ignoreMissingStyleImages } from "./map/mapImages";

type LocatedPhoto = PartialPhotoWithLocation & { exif_gps_lat: number; exif_gps_lon: number };

const isLocated = (photo: PartialPhotoWithLocation): photo is LocatedPhoto =>
  photo.exif_gps_lon !== null && photo.exif_gps_lat !== null;

type Props = {
  photos: PartialPhotoWithLocation[];
};

export function AlbumLocationMap({ photos }: Readonly<Props>) {
  // Null while map display is turned off
  const { mapStyle } = useMapStyle();
  const photosWithGPS = useMemo(() => photos.filter(isLocated), [photos]);
  const { avgLat, avgLon } = getAveragedCoordinates(photosWithGPS);

  const markers = useMemo(
    () =>
      photosWithGPS.map(photo => (
        <Marker
          key={`marker-${photo.id}`}
          longitude={photo.exif_gps_lon}
          latitude={photo.exif_gps_lat}
          anchor="bottom"
        />
      )),
    [photosWithGPS]
  );

  if (photosWithGPS.length > 0 && mapStyle === null) {
    return <MapDisabledPlaceholder height="300px" />;
  }

  if (photosWithGPS.length > 0 && mapStyle !== null) {
    return (
      <div style={{ padding: 0 }}>
        <MapGL
          ref={ignoreMissingStyleImages}
          initialViewState={{
            longitude: avgLon,
            latitude: avgLat,
            zoom: 6,
          }}
          style={{ width: "100%", height: "300px" }}
          mapStyle={mapStyle}
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
