// The map layers' colours. maplibre paints them from plain values, not CSS variables. This file is a
// named home for colour literals, so src/architecture/styles.test.ts does not count it (AGENTS.md,
// Styling).

export type MapLayerColors = Readonly<{
  /** Cluster circles by size: under 10 photos, under 50, and 50 or more. */
  clusters: Readonly<{ small: string; medium: string; large: string }>;
  /** The photo count on a cluster circle. */
  clusterText: string;
  /** A single place, and the ring around it. */
  point: string;
  pointStroke: string;
}>;

/** The colours as they should look, and as a light map paints them. */
const LIGHT_MAP_LAYER_COLORS: MapLayerColors = {
  clusters: { small: "#51bbd6", medium: "#f1f075", large: "#f28cb1" },
  clusterText: "#000",
  point: "#11b4da",
  pointStroke: "#fff",
};

/**
 * What a dark map paints. In dark mode the whole canvas goes through
 * `invert(1) hue-rotate(180deg) brightness(0.9)` (components/map/ThemedMap.module.css), so these
 * are the colours that filter turns back into the light ones above, each the closest it can reach
 * (CIELAB). The filter caps brightness at 90 % and clamps on the way, so white comes out as a
 * light grey and the yellow as an olive yellow. mapColors.test.ts runs the filter over them: change
 * a light colour or the filter, and that test says which one to recompute.
 */
const DARK_MAP_LAYER_COLORS: MapLayerColors = {
  clusters: { small: "#00607b", medium: "#505b00", large: "#b72951" },
  clusterText: "#fff",
  point: "#007096",
  pointStroke: "#000",
};

/** The colours to paint the layers with on a map in this colour scheme. */
export function mapLayerColors(scheme: "light" | "dark"): MapLayerColors {
  return scheme === "dark" ? DARK_MAP_LAYER_COLORS : LIGHT_MAP_LAYER_COLORS;
}
