// The statistics charts' own colours. They are deliberate, not theme colours: a chart needs more
// distinct hues than the theme has, and canvas and d3 drawing takes plain values rather than CSS
// variables. This file and brandGradients.ts are the named homes for colour literals, so
// src/architecture/styles.test.ts does not count them (AGENTS.md, Styling).

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

/** The face cluster canvas: its grid lines and the ring around a known face, per colour scheme. */
export const FACE_CLUSTER_CANVAS_COLORS = {
  grid: { dark: "rgba(255, 255, 255, 0.05)", light: "rgba(0, 0, 0, 0.05)" },
  pointBorder: { dark: "rgba(255, 255, 255, 0.3)", light: "rgba(0, 0, 0, 0.2)" },
} as const;

/** Word cloud words, assigned in order and repeated. */
export const WORD_CLOUD_COLORS = [
  "#6366f1", // indigo
  "#8b5cf6", // violet
  "#a855f7", // purple
  "#d946ef", // fuchsia
  "#ec4899", // pink
  "#f43f5e", // rose
  "#0ea5e9", // sky
  "#14b8a6", // teal
  "#10b981", // emerald
  "#84cc16", // lime
] as const;

/** The location tree's node gradients: the root, places with children, and leaves. */
export const LOCATION_NODE_GRADIENTS = {
  root: { from: "#6366f1", to: "#8b5cf6" }, // Indigo to violet
  branch: { from: "#0ea5e9", to: "#06b6d4" }, // Sky to cyan
  leaf: { from: "#10b981", to: "#34d399" }, // Emerald shades
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
  link: "#12939A",
  nodeStroke: "#fff",
} as const;
