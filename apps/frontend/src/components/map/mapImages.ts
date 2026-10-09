import type { MapRef } from "react-map-gl/maplibre";

const EMPTY_IMAGE = { width: 1, height: 1, data: new Uint8Array(4) };

/**
 * Pass as (or call from) a map's `ref`: the default map style names POI icons
 * (office_11, atm_11, ...) that its sprite does not contain, and MapLibre logs
 * a warning for each one a map needs. Those icons never showed; registering a
 * transparent stand-in when one is asked for keeps the console readable.
 */
export function ignoreMissingStyleImages(ref: MapRef | null) {
  // Optional calls: test doubles of the map implement neither.
  const map = ref?.getMap?.();
  if (!map?.setMissingStyleImageResolver) return;
  map.setMissingStyleImageResolver(id => {
    if (!map.hasImage(id)) map.addImage(id, EMPTY_IMAGE);
  });
}
