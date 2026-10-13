import type { CompletePersonFace } from "../../api_client/faces/types";
import type { FacesTab } from "./facesTab";
import type { FaceCell, GridRows } from "./hooks/useVirtualizedGrid";
import { isPersonCell } from "./hooks/useVirtualizedGrid";

/** What one face's buttons and ⋮ menu do; the dashboard owns the mutations and the dialogs. */
export type FaceActionHandlers = Readonly<{
  /** Labels the face as the person its group suggests. */
  confirm: (face: FaceCell, personName: string) => void;
  /** Sends the face back to "Unknown - Other". */
  rejectMatch: (face: FaceCell) => void;
  /** Opens the Label faces dialog for this one face. */
  labelAs: (face: FaceCell) => void;
  /** Asks, then deletes the face. */
  remove: (face: FaceCell) => void;
}>;

/**
 * How the menu words sending a face back to "Unknown - Other": "Not Anna" for a named person,
 * "Move to Unknown - Other" for a cluster, nothing for faces already there.
 */
export type WrongMatch = "person" | "cluster" | null;

/**
 * A one-click Confirm only makes sense for an inferred face whose group is a named person: a
 * cluster's name ("Unknown 001") is no one's, and the unknown group is where faces go when rejected.
 * The group header's "Confirm all" follows the same rule.
 */
export function canConfirmFace(tab: FacesTab, group: CompletePersonFace): boolean {
  return tab === "inferred" && group.kind === "USER";
}

export function wrongMatchFor(group: CompletePersonFace): WrongMatch {
  if (group.kind === "USER") return "person";
  if (group.kind === "CLUSTER") return "cluster";
  return null;
}

/**
 * The group each grid row belongs to: a header row starts a group and the face rows below it are
 * its faces. Rows before the first header (none in practice) have no group.
 */
export function groupsByRow(rows: GridRows): Array<CompletePersonFace | undefined> {
  let current: CompletePersonFace | undefined;
  return rows.map(row => {
    const first = row[0];
    if (first && isPersonCell(first)) current = first;
    return current;
  });
}
