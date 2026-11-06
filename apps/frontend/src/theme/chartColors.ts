// The statistics charts' own colours. They are deliberate, not theme colours: a chart needs more
// distinct hues than the theme has, and canvas and d3 drawing takes plain values rather than CSS
// variables. This file is a named home for colour literals, so src/architecture/styles.test.ts
// does not count them (AGENTS.md, Styling).

/** One colour per person in the face cluster graph, assigned in order and repeated. */
export const FACE_CLUSTER_COLORS = [
  "#FF6B6B", // Coral Red
  "#4ECDC4", // Teal
  "#45B7D1", // Sky Blue
  "#96CEB4", // Sage Green
  "#FFEAA7", // Soft Yellow
  "#DDA0DD", // Plum
  "#98D8C8", // Mint
  "#F7DC6F", // Sunflower
  "#BB8FCE", // Lavender
  "#85C1E9", // Light Blue
  "#F8B500", // Golden
  "#FF8C94", // Salmon
  "#A8E6CF", // Seafoam
  "#FFD93D", // Bright Yellow
  "#6BCB77", // Green
  "#4D96FF", // Royal Blue
  "#FF6B9D", // Pink
  "#C9B1FF", // Periwinkle
  "#FFB347", // Orange
  "#87CEEB", // Sky
] as const;

/** Faces that belong to nobody yet. */
export const FACE_CLUSTER_UNKNOWN_COLOR = "rgba(100, 100, 100, 0.4)";

/** The canvas fill of a face that belongs to nobody yet, at the given opacity. */
export const faceClusterUnknownFill = (opacity: number) => `rgba(100, 100, 100, ${opacity})`;

/** The face cluster canvas: its grid lines and the ring around a known face, per colour scheme. */
export const FACE_CLUSTER_CANVAS_COLORS = {
  grid: { dark: "rgba(255, 255, 255, 0.05)", light: "rgba(0, 0, 0, 0.05)" },
  pointBorder: { dark: "rgba(255, 255, 255, 0.3)", light: "rgba(0, 0, 0, 0.2)" },
} as const;

/**
 * Word cloud words, assigned in order and repeated: the theme's blue accent in mid shades and two
 * greys, so the cloud stays in the app's one accent and reads on light and dark cards alike.
 */
export const WORD_CLOUD_COLORS = [
  "#228be6", // blue 6
  "#868e96", // gray 6
  "#339af0", // blue 5
  "#1c7ed6", // blue 7
  "#adb5bd", // gray 5
  "#4dabf7", // blue 4
  "#1971c2", // blue 8
  "#74c0fc", // blue 3
] as const;

/**
 * The location tree's node gradients: the root in the accent, places with children in a dark grey
 * and leaves in a lighter one, so only the root carries colour. White text reads on all three.
 */
export const LOCATION_NODE_GRADIENTS = {
  root: { from: "#228be6", to: "#1c7ed6" }, // Blue 6 to 7: the accent
  branch: { from: "#495057", to: "#343a40" }, // Gray 7 to 8
  leaf: { from: "#868e96", to: "#6c757d" }, // Gray 6 to a step darker
} as const;

/** The location tree's links (slate with transparency, in both colour schemes). */
export const LOCATION_LINK_COLOR = "rgba(148, 163, 184, 0.4)";

/** Text on a location node: its photo count and the expand indicator. */
export const LOCATION_NODE_TEXT_COLORS = {
  count: "rgba(255,255,255,0.75)",
  indicator: "rgba(255,255,255,0.8)",
} as const;

/** The social graph: links between people and the ring around a person. */
export const SOCIAL_GRAPH_COLORS = {
  link: "#adb5bd", // gray 5: links are structure, the faces are the content
  nodeStroke: "#fff",
} as const;

/**
 * The location timeline: one colour per place, for the places with the most time (the rest share
 * LOCATION_TIMELINE_OTHER_COLOR). Tableau 10's calm, distinguishable hues, so the bar reads as a
 * few countries instead of a rainbow of stays.
 */
export const LOCATION_TIMELINE_COLORS = [
  "#4E79A7", // Blue
  "#F28E2B", // Orange
  "#59A14F", // Green
  "#E15759", // Red
  "#76B7B2", // Teal
  "#EDC948", // Yellow
  "#B07AA1", // Purple
  "#FF9DA7", // Pink
] as const;

/** The places past the palette, grouped as "Other". */
export const LOCATION_TIMELINE_OTHER_COLOR = "#BAB0AC";
