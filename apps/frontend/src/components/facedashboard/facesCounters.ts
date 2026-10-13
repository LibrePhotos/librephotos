import type { CompletePersonFaceList } from "../../api_client/faces";
import type { FacesTab } from "./facesTab";

/** The lists the faces page shows, one per tab (`useFaceDataFetching`'s `lists`). */
export type FacesTabLists = Readonly<Record<FacesTab, CompletePersonFaceList>>;

type GroupCount = { groups: number; faces: number };

/** What the tabs' badges and hover cards say, counted from the lists on screen (#2236). */
export type FacesCounters = {
  labeled: GroupCount;
  /** People the inferred list assumes, without the unknown group. */
  inferred: GroupCount;
  /** Every group of the inferred request: the assumed people plus the unknown group. */
  clusters: GroupCount;
  unknown: GroupCount;
};

const count = (list: CompletePersonFaceList): GroupCount => ({
  groups: list.length,
  faces: list.reduce((sum, person) => sum + person.faces.length, 0),
});

export function countFaces(lists: FacesTabLists): FacesCounters {
  return {
    labeled: count(lists.labeled),
    inferred: count(lists.inferred),
    clusters: count([...lists.inferred, ...lists.unknown]),
    unknown: count(lists.unknown),
  };
}
