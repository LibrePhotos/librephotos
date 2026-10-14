import { UNKNOWN_PERSON_NAME } from "@librephotos/api-client";
import { z } from "zod";

/**
 * The faces dashboard's tabs (its `tab` URL parameter). "deleted" lists the deleted faces, by the
 * person each one had, so they can be restored (#127).
 */
export const FacesTab = z.enum(["labeled", "inferred", "unknown", "deleted"]);
export type FacesTab = z.infer<typeof FacesTab>;

/**
 * The order the faces dashboard keeps in its URL: the backend's two orders, plus "person",
 * an older order the dashboard still sorts by date.
 */
export const FacesRouteOrder = z.enum(["confidence", "date", "person"]);
export type FacesRouteOrder = z.infer<typeof FacesRouteOrder>;

/**
 * Whether a group of the face lists is "Unknown - Other", the faces nobody is suggested for. The
 * backend appends it with id 0 and its name as its kind (not "UNKNOWN"), so its name is what
 * tells it apart. The Unknown tab lists it; the other tabs leave it out.
 */
export function isUnknownGroup(group: Readonly<{ name: string }>): boolean {
  return group.name === UNKNOWN_PERSON_NAME;
}

/**
 * The order of the people (groups) on the dashboard (its `personOrder` URL parameter): by name, as
 * the server sends them, or the people with the most faces first (#764).
 */
export const FacesPersonOrder = z.enum(["name", "count"]);
export type FacesPersonOrder = z.infer<typeof FacesPersonOrder>;
