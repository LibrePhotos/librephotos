import { isUnknownGroup, type FacesPersonOrder } from "./facesTab";

type Group = Readonly<{ name: string; face_count: number; similarity_rank?: number | null }>;

/** Lower ranks first; a group without one (no cluster, an older server) after every ranked one. */
function byRank(a: number | null | undefined, b: number | null | undefined): number {
  const rankA = a ?? Number.POSITIVE_INFINITY;
  const rankB = b ?? Number.POSITIVE_INFINITY;
  return rankA === rankB ? 0 : rankA - rankB;
}

/** How two people compare in each order; 0 keeps the server's name order between them. */
const COMPARE: Record<FacesPersonOrder, (a: Group, b: Group) => number> = {
  name: () => 0,
  count: (a, b) => b.face_count - a.face_count,
  // The server's chain of look-alike groups (#622)
  similar: (a, b) => byRank(a.similarity_rank, b.similarity_rank),
};

/**
 * The people of a tab in the order the dashboard shows them (#764). The server sends them by name,
 * so name order keeps its list; "count" puts the people with the most faces first, keeping name
 * order among equal counts; "similar" puts groups whose faces look alike next to each other, by the
 * server's `similarity_rank` (#622), groups without one last in name order. Either way "Unknown -
 * Other", which is no one, comes last. Returns a new array: the list is the query cache's, which
 * must not change under it.
 */
export function orderPeople<T extends Group>(people: readonly T[], order: FacesPersonOrder): T[] {
  const compare = COMPARE[order];
  // Array.prototype.sort is stable, so equal people keep the server's name order
  return [...people].sort((a, b) => Number(isUnknownGroup(a)) - Number(isUnknownGroup(b)) || compare(a, b));
}
