// The map layers' colours. maplibre paints them from plain values, not CSS variables. This file is a
// named home for colour literals, so src/architecture/styles.test.ts does not count it (AGENTS.md,
// Styling).

export type MapLayerColors = Readonly<{
  /** Cluster circles by size: under 10 photos, under 50, and 50 or more. Shades of the accent. */
  clusters: Readonly<{ small: string; medium: string; large: string }>;
  /** The photo count on a cluster circle, and the ring around it. */
  clusterText: string;
  /** A single place, and the ring around it. */
  point: string;
  pointStroke: string;
  /** Your places (#1365): their circles' outline, and their fill at a low opacity. */
  place: string;
}>;

/**
 * The colours as they should look, and as a light map paints them: the theme's blue accent (blue 6,
 * 7 and 8, darker as a cluster grows) with white counts and rings, so the map uses the app's one
 * accent rather than a palette of its own.
 */
const LIGHT_MAP_LAYER_COLORS: MapLayerColors = {
  clusters: { small: "#228be6", medium: "#1c7ed6", large: "#1971c2" },
  clusterText: "#fff",
  point: "#228be6",
  pointStroke: "#fff",
  place: "#228be6",
};

/**
 * What a dark map paints. In dark mode the whole canvas goes through
 * `invert(1) hue-rotate(180deg) brightness(0.9)` (components/map/ThemedMap.module.css), so these
 * are the colours that filter turns back into the light ones above, each the closest it can reach
 * (CIELAB). The filter caps brightness at 90 %, so white comes out as a light grey. mapColors.test.ts runs the filter over them: change
 * a light colour or the filter, and that test says which one to recompute.
 */
const DARK_MAP_LAYER_COLORS: MapLayerColors = {
  clusters: { small: "#1388ed", medium: "#2693f5", large: "#3c9ef8" },
  clusterText: "#000",
  point: "#1388ed",
  pointStroke: "#000",
  place: "#1287f1",
};

/** The colours to paint the layers with on a map in this colour scheme. */
export function mapLayerColors(scheme: "light" | "dark"): MapLayerColors {
  return scheme === "dark" ? DARK_MAP_LAYER_COLORS : LIGHT_MAP_LAYER_COLORS;
}

/**
 * The basemap's water, softer than the style's own saturated blue (components/map/basemap.ts). One
 * value for both schemes: it is painted under the dark mode filter like the rest of the basemap.
 */
export const BASEMAP_WATER_COLOR = "#c3daef";
