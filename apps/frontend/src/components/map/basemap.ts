import { BASEMAP_COLORS, BASEMAP_WATER_COLOR } from "../../theme/mapColors";

/** The paint properties these helpers change. */
type PaintName =
  | "fill-opacity"
  | "fill-color"
  | "fill-extrusion-color"
  | "background-color"
  | "line-color"
  | "text-color"
  | "text-halo-color"
  | "text-halo-width"
  | "text-halo-blur";

/** What these helpers use of a MapLibre map. */
type StyledMap = Readonly<{
  getLayer: (id: string) => unknown;
  /** The style's layers, to restyle them by id and type; undefined before the style loaded. */
  getStyle: () => { layers?: readonly Readonly<{ id: string; type: string; "source-layer"?: string }>[] } | undefined;
  setLayoutProperty: (layer: string, name: "visibility", value: "none") => unknown;
  setPaintProperty: (layer: string, name: PaintName, value: number | string) => unknown;
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

// Woods, parks and fields stay as a hint of colour rather than the style's saturated greens.
const LANDCOVER_OPACITY = 0.35;
const LANDCOVER = /^(landcover|landuse)-/;
const ROAD = /^(highway|bridge|tunnel)-(motorway|link|trunk|primary|secondary|minor|service)/;
// The names the style paints pale on dark halos below zoom 6, for its satellite imagery.
const PLACE_NAME = /^place-/;
const WATER_NAME = /^water(way)?-name/;

/** The text colour and halo of a label layer: grey on the land colour, blue-grey on the water. */
function calmLabel(map: StyledMap, id: string): void {
  const onWater = WATER_NAME.test(id);
  if (onWater || PLACE_NAME.test(id)) {
    map.setPaintProperty(id, "text-color", onWater ? BASEMAP_COLORS.waterLabel : BASEMAP_COLORS.label);
  }
  map.setPaintProperty(id, "text-halo-color", onWater ? BASEMAP_WATER_COLOR : BASEMAP_COLORS.land);
  map.setPaintProperty(id, "text-halo-width", 1);
  map.setPaintProperty(id, "text-halo-blur", 0);
}

/**
 * A calmer basemap within the configured style, after Positron: a neutral land colour, faint
 * landcover, grey buildings, white roads on grey casings, and labels with a thin halo of the colour
 * under them instead of the style's heavy dark ones, which read as doubled glyphs. Only layers the
 * style has are touched, by their PhotoPrism/OpenMapTiles ids; a raster style (OSM) has none of them.
 */
export function calmBasemap(map: StyledMap): void {
  for (const layer of map.getStyle()?.layers ?? []) {
    // The app's own layers (clusters, points, your places) come from GeoJSON, with no source layer:
    // they keep their paint. Only the basemap's tile layers and its background change.
    if (layer.type === "background" || layer["source-layer"] !== undefined) calmLayer(map, layer.id, layer.type);
  }
}

function calmLayer(map: StyledMap, id: string, type: string): void {
  const paint = (name: PaintName, value: number | string) => map.setPaintProperty(id, name, value);
  if (type === "background") paint("background-color", BASEMAP_COLORS.land);
  else if (type === "fill" && LANDCOVER.test(id)) paint("fill-opacity", LANDCOVER_OPACITY);
  else if (type === "fill" && id.startsWith("building")) paint("fill-color", BASEMAP_COLORS.building);
  // At street level the style raises its buildings in 3D, in beige
  else if (type === "fill-extrusion") paint("fill-extrusion-color", BASEMAP_COLORS.building);
  else if (type === "line" && ROAD.test(id)) {
    paint("line-color", id.endsWith("-casing") ? BASEMAP_COLORS.roadCasing : BASEMAP_COLORS.road);
  } else if (type === "symbol") calmLabel(map, id);
}

/**
 * Folds a compact attribution to its ⓘ button. MapLibre opens it until the first drag, where it
 * covered a quarter of a small map; a click on the button still opens it.
 */
export function foldAttribution(map: StyledMap): void {
  map.getContainer().querySelector(".maplibregl-compact-show")?.classList.remove("maplibregl-compact-show");
}
