import React from "react";
import { Map, Marker, TileLayer } from "react-leaflet";

type Props = {
  photos: any[];
};

export function AlbumLocationMap({ photos }: Readonly<Props>) {
  const photosWithGPS = photos.filter(photo => photo.exif_gps_lon !== null && photo.exif_gps_lon);
  let sumLat = 0;
  let sumLon = 0;
  for (const element of photosWithGPS) {
    sumLat += parseFloat(element.exif_gps_lat);
    sumLon += parseFloat(element.exif_gps_lon);
  }
  const avgLat = sumLat / photosWithGPS.length;
  const avgLon = sumLon / photosWithGPS.length;

  const markers = photosWithGPS.map(photo => (
    <Marker key={`marker-${photo.id}`} position={[photo.exif_gps_lat, photo.exif_gps_lon]} />
  ));
  if (photosWithGPS.length > 0) {
    return (
      <div style={{ padding: 0 }}>
        <Map center={[avgLat, avgLon]} zoom={6}>
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
