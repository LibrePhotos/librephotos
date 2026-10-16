import { Media, type PhotoSimple } from "@librephotos/api-client";
import { groupBy } from "lodash-es";

/** An event photo (`PhotoSimple`) as a grid tile of the event page. */
export function eventGridPhoto(photo: PhotoSimple) {
  return {
    id: photo.id,
    hash: photo.image_hash,
    video: photo.video,
    timestamp: photo.exif_timestamp,
    image_hash: photo.image_hash,
    exif_timestamp: photo.exif_timestamp,
    rating: photo.rating,
    public: photo.public,
    geolocation_json: photo.geolocation_json,
    // The Media values the tile overlays check, so videos get their play badge
    type: photo.video ? Media.VIDEO : Media.IMAGE,
    // Square only for backends that do not send the ratio yet
    aspectRatio: photo.aspectRatio ?? 1,
    // Empty lets the tile show the page behind it, as other grids do without a colour
    dominantColor: photo.dominantColor ?? "",
    video_length: photo.video_length,
    is_hdr: photo.is_hdr ?? false,
    animated_preview: photo.animated_preview,
    // The grid fields an event photo has no source for
    shared_to: [],
    isTemp: false,
    has_raw_variant: false,
    style: {
      width: 200,
      height: 200,
      translateX: 0,
      translateY: 0,
    },
  };
}

/** The event's photos, already sorted by time, as one group per day for the grid. */
export function eventPhotoGroups(photos: PhotoSimple[]) {
  const byDate = groupBy(photos, photo => photo.exif_timestamp.split("T")[0]);
  return Object.entries(byDate).map(([date, items]) => ({
    date,
    location: null,
    items: items.map(eventGridPhoto),
  }));
}
