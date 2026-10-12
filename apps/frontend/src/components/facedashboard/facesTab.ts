import { z } from "zod";

/** The faces dashboard's tabs (its `tab` URL parameter). */
export const FacesTab = z.enum(["labeled", "inferred", "unknown"]);
export type FacesTab = z.infer<typeof FacesTab>;

/**
 * The order the faces dashboard keeps in its URL: the backend's two orders, plus "person",
 * an older order the dashboard still sorts by date.
 */
export const FacesRouteOrder = z.enum(["confidence", "date", "person"]);
export type FacesRouteOrder = z.infer<typeof FacesRouteOrder>;
