import { BASEMAP_WATER_COLOR } from "../../theme/mapColors";

/** What these helpers use of a MapLibre map. */
type StyledMap = Readonly<{
  getLayer: (id: string) => unknown;
  setLayoutProperty: (layer: string, name: "visibility", value: "none") => unknown;
  setPaintProperty: (layer: string, name: "fill-opacity" | "fill-color", value: number | string) => unknown;
  getContainer: () => HTMLElement;
}>;

// PhotoPrism's style (util/mapStyle.ts) paints NASA's Blue Marble imagery under zoom 8 and fades its
// water in only from zoom 5, so a zoomed-out map was a dark satellite picture whatever the theme.
// Without the imagery and with the water at every zoom it is the same flat map at every zoom: light,
// and in dark mode dark through ThemedMap's filter. Its water is a soft blue rather than the style's
// saturated one. Other styles have no such layers.
const IMAGERY_LAYERS = ["natural_earth"];
const WATER_LAYERS = ["water"];

/** Hides the style's satellite imagery and shows its water at every zoom, so the basemap follows the theme. */
export function flattenBasemap(map: StyledMap): void {
  for (const id of IMAGERY_LAYERS) {
    if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", "none");
  }
  for (const id of WATER_LAYERS) {
    if (!map.getLayer(id)) continue;
    map.setPaintProperty(id, "fill-opacity", 1);
    map.setPaintProperty(id, "fill-color", BASEMAP_WATER_COLOR);
  }
}

/**
 * Folds a compact attribution to its ⓘ button. MapLibre opens it until the first drag, where it
 * covered a quarter of a small map; a click on the button still opens it.
 */
export function foldAttribution(map: StyledMap): void {
  map.getContainer().querySelector(".maplibregl-compact-show")?.classList.remove("maplibregl-compact-show");
}
