import _ from "lodash";
import React from "react";
import { Map, Marker, TileLayer } from "react-leaflet";

type Props = {
  photos: any[];
};

export function AlbumLocationMap(props: Readonly<Props>) {
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

  const markers = photosWithGPS.map((photo, idx) => (
    <Marker key={`marker-${photo.id}-${idx}`} position={[photo.exif_gps_lat, photo.exif_gps_lon]} />
  ));
  if (photosWithGPS.length > 0) {
    return (
      <div style={{ padding: 0 }}>
        <Map center={[avg_lat, avg_lon]} zoom={6}>
          <TileLayer
            attribution='&copy; <a href="https://osm.org/copyright">OpenStreetMap</a> contributors'
            url="https://{s}.tile.osm.org/{z}/{x}/{y}.png"
          />
          {markers}
        </Map>
      </div>
    );
  }
  return <div />;
}
