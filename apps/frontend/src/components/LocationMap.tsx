import { Box, Image, Loader } from "@mantine/core";
import React, { useEffect, useRef } from "react";
import { Map, Marker, Popup, TileLayer } from "react-leaflet";

type Props = {
  photos: any[];
};

export function LocationMap(props: Props) {
  const mapRef = useRef<Map>(null);

  const height = "200px";

  useEffect(() => {
    mapRef.current?.leafletElement.invalidateSize();
  }, [height, props]);

  const photosWithGPS = props.photos.filter(photo => {
    if (photo.exif_gps_lon !== null && photo.exif_gps_lon) {
      return true;
    }
    return false;
  });

  let sum_lat = 0;
  let sum_lon = 0;
  for (let i = 0; i < photosWithGPS.length; i += 1) {
    sum_lat += parseFloat(photosWithGPS[i].exif_gps_lat);
    sum_lon += parseFloat(photosWithGPS[i].exif_gps_lon);
  }
  const avg_lat = sum_lat / photosWithGPS.length;
  const avg_lon = sum_lon / photosWithGPS.length;

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
        <Map ref={mapRef} style={{ height }} center={[avg_lat, avg_lon]} zoom={zoom}>
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
