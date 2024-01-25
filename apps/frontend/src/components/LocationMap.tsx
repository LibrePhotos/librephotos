import { Box, Image, Loader } from "@mantine/core";
import React, { useEffect, useRef } from "react";
import { Map, Marker, Popup, TileLayer } from "react-leaflet";

import { getAveragedCoordinates } from "../util/util";

type Props = Readonly<{
  photos: any[];
}>;

export function LocationMap({ photos }: Props) {
  const mapRef = useRef<Map>(null);
  const height = "200px";

  useEffect(() => {
    mapRef.current?.leafletElement.invalidateSize();
  }, [height, photos]);

  const photosWithGPS = photos.filter(photo => photo.exif_gps_lon !== null && photo.exif_gps_lon);
  const { avgLat, avgLon } = getAveragedCoordinates(photosWithGPS);

  const markers = photosWithGPS.map(photo => (
    <Marker key={photo.image_hash} position={[photo.exif_gps_lat, photo.exif_gps_lon]}>
      <Popup>
        <div>
          <Image src={photo.square_thumbnail} />
        </div>
      </Popup>
    </Marker>
  ));

  if (photosWithGPS.length > 0) {
    const zoom = 16;
    return (
      <Box style={{ zIndex: 2, height, padding: 0 }}>
        <Map ref={mapRef} style={{ height }} center={[avgLat, avgLon]} zoom={zoom}>
          <TileLayer
            attribution='&copy; <a href="https://osm.org/copyright">OpenStreetMap</a> contributors'
            url="https://{s}.tile.osm.org/{z}/{x}/{y}.png"
          />
          {markers}
        </Map>
      </Box>
    );
  }
  return (
    <Box style={{ height }}>
      <Loader>Map loading...</Loader>
    </Box>
  );
}
