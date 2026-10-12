// The map layers' colours. maplibre paints them from plain values, not CSS variables, and the base
// map looks the same in both colour schemes. This file is a named home for colour literals, so
// src/architecture/styles.test.ts does not count it (AGENTS.md, Styling).

/** Cluster circles by size: under 10 photos, under 50, and 50 or more. */
export const MAP_CLUSTER_COLORS = { small: "#51bbd6", medium: "#f1f075", large: "#f28cb1" } as const;

/** The photo count on a cluster circle. */
export const MAP_CLUSTER_TEXT_COLOR = "#000";

/** A single place, and the ring around it. */
export const MAP_POINT_COLOR = "#11b4da";
export const MAP_POINT_STROKE_COLOR = "#fff";
