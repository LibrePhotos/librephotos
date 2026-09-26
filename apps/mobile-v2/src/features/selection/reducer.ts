/**
 * Grid multi-select reducer (doc 05 — "multi-select" on all mirror grids).
 * Pure + framework-free so it is unit-tested directly. A grid holds this state,
 * enters on long-press, toggles on tap, and toggles whole day-sections from the
 * section header. Each selected entry keeps BOTH ids a mutation needs (the UUID
 * photo id for album membership, the image hash for /photosedit endpoints).
 */
export type SelectableItem = {
  key: string;
  photoId: string | null;
  imageHash: string | null;
};

export type SelectionState = {
  active: boolean;
  /** key → item. A plain record keeps the state serializable + easy to diff. */
  selected: Record<string, SelectableItem>;
};

export type SelectionAction =
  | { type: "enter"; item: SelectableItem }
  | { type: "toggle"; item: SelectableItem }
  /** Toggle a group (a day section): select all if any missing, else clear them. */
  | { type: "toggleGroup"; items: SelectableItem[] }
  | { type: "clear" };

export const emptySelection: SelectionState = { active: false, selected: {} };

/** Auto-exit selection mode once nothing is selected. */
function normalize(selected: Record<string, SelectableItem>): SelectionState {
  const active = Object.keys(selected).length > 0;
  return { active, selected };
}

export function selectionReducer(state: SelectionState, action: SelectionAction): SelectionState {
  switch (action.type) {
    case "enter":
      return { active: true, selected: { [action.item.key]: action.item } };
    case "toggle": {
      const next = { ...state.selected };
      if (next[action.item.key]) delete next[action.item.key];
      else next[action.item.key] = action.item;
      return normalize(next);
    }
    case "toggleGroup": {
      const keys = action.items.map((i) => i.key);
      const allSelected = keys.length > 0 && keys.every((k) => state.selected[k]);
      const next = { ...state.selected };
      if (allSelected) {
        for (const k of keys) delete next[k];
      } else {
        for (const i of action.items) next[i.key] = i;
      }
      return normalize(next);
    }
    case "clear":
      return emptySelection;
  }
}

/* ---- selectors ---------------------------------------------------------- */

export function selectedItems(state: SelectionState): SelectableItem[] {
  return Object.values(state.selected);
}
export function selectionCount(state: SelectionState): number {
  return Object.keys(state.selected).length;
}
export function isSelected(state: SelectionState, key: string): boolean {
  return state.selected[key] != null;
}
/** Distinct image hashes of the selection (for /photosedit endpoints). */
export function selectedImageHashes(state: SelectionState): string[] {
  return [...new Set(selectedItems(state).map((i) => i.imageHash).filter((h): h is string => !!h))];
}
/** Distinct photo ids of the selection (for album membership). */
export function selectedPhotoIds(state: SelectionState): string[] {
  return [...new Set(selectedItems(state).map((i) => i.photoId).filter((p): p is string => !!p))];
}
