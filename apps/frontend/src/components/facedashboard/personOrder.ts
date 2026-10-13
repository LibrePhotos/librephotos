import { isUnknownGroup, type FacesPersonOrder } from "./facesTab";

type Group = Readonly<{ name: string; face_count: number }>;

/**
 * The people of a tab in the order the dashboard shows them (#764). The server sends them by name,
 * so name order keeps its list; "count" puts the people with the most faces first, keeping name
 * order among equal counts. Either way "Unknown - Other", which is no one, comes last. Returns a new array: the list
 * is the query cache's, which must not change under it.
 */
export function orderPeople<T extends Group>(people: readonly T[], order: FacesPersonOrder): T[] {
  const byCount = (a: T, b: T) => (order === "count" ? b.face_count - a.face_count : 0);
  // Array.prototype.sort is stable, so equal people keep the server's name order
  return [...people].sort((a, b) => Number(isUnknownGroup(a)) - Number(isUnknownGroup(b)) || byCount(a, b));
}
