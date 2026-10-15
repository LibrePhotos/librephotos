import { createContext, useContext, useEffect } from "react";

/** The editors that hold a draft until their own Save: what a draft is named by in the dialog. */
const DRAFT_FIELDS = ["date", "caption", "tags", "location"] as const;

export type DraftField = (typeof DRAFT_FIELDS)[number];

/**
 * Which editors of one photo view hold an edit that differs from the saved value (#2284). The
 * lightbox and the photo page create one each and hand it down by context; the editors report to
 * it, and the view asks before an action that would throw the drafts away.
 */
export type UnsavedDrafts = {
  /** Marks a field's draft as differing from the saved value, or not. */
  set: (field: DraftField, dirty: boolean) => void;
  /** The fields with a draft, in `DRAFT_FIELDS` order; the same array until that changes. */
  dirtyFields: () => readonly DraftField[];
  /**
   * Forgets every draft, once the user chose to discard them. The action that follows unmounts or
   * remounts the editors holding them (a new photo, a closed lightbox, another page), and a
   * remounted editor starts clean.
   */
  discardAll: () => void;
  subscribe: (listener: () => void) => () => void;
};

export function createUnsavedDrafts(): UnsavedDrafts {
  const dirty = new Set<DraftField>();
  const listeners = new Set<() => void>();
  let snapshot: readonly DraftField[] = [];

  const changed = () => {
    snapshot = DRAFT_FIELDS.filter(field => dirty.has(field));
    listeners.forEach(listener => listener());
  };

  return {
    set(field, isDirty) {
      if (dirty.has(field) === isDirty) return;
      if (isDirty) dirty.add(field);
      else dirty.delete(field);
      changed();
    },
    dirtyFields: () => snapshot,
    discardAll() {
      if (dirty.size === 0) return;
      dirty.clear();
      changed();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

// Outside a lightbox or the photo page an editor has nothing to report to: the default is inert.
const NO_DRAFTS: UnsavedDrafts = {
  set: () => {},
  dirtyFields: () => [],
  discardAll: () => {},
  subscribe: () => () => {},
};

export const UnsavedDraftsContext = createContext<UnsavedDrafts>(NO_DRAFTS);

/**
 * Reports an editor's draft: `dirty` is whether it differs from the saved value, so an editor that
 * is open but unchanged never stops anything. Unmounting withdraws it.
 */
export function useRegisterDraft(field: DraftField, dirty: boolean) {
  const drafts = useContext(UnsavedDraftsContext);
  useEffect(() => {
    drafts.set(field, dirty);
    return () => drafts.set(field, false);
  }, [drafts, field, dirty]);
}
