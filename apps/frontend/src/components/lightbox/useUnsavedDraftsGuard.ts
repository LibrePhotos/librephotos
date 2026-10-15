import { useBlocker } from "@tanstack/react-router";
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { useBeforeUnloadWarning } from "../../hooks/useBeforeUnloadWarning";
import type { DraftField, UnsavedDrafts } from "./unsavedDrafts";
import { createUnsavedDrafts } from "./unsavedDrafts";

/**
 * Leaving the view while a draft is unsaved (#2284): Back, a link, and a reload or a closed tab. A
 * navigation waits on the returned blocker (`blocked`: `proceed` leaves, `reset` stays); the browser
 * asks about a reload itself. Whether to block is read from the drafts when the navigation starts,
 * so one that follows a Discard goes through.
 */
export function useDraftsLeaveGuard(drafts: UnsavedDrafts) {
  const dirtyFields = useSyncExternalStore(drafts.subscribe, drafts.dirtyFields);
  const dirty = dirtyFields.length > 0;
  useBeforeUnloadWarning(dirty);
  const blocker = useBlocker({
    shouldBlockFn: () => drafts.dirtyFields().length > 0,
    enableBeforeUnload: false,
    disabled: !dirty,
    withResolver: true,
  });
  // A save that lands while the question is open leaves nothing to lose: let the navigation go.
  const { status, proceed } = blocker;
  useEffect(() => {
    if (!dirty && status === "blocked") proceed?.();
  }, [dirty, status, proceed]);
  return { dirtyFields, blocker };
}

/** A view's own drafts, created once per mount. */
export function useUnsavedDrafts(): UnsavedDrafts {
  const [drafts] = useState(createUnsavedDrafts);
  return drafts;
}

type DraftsDialog = Readonly<{
  opened: boolean;
  fields: readonly DraftField[];
  onKeepEditing: () => void;
  onDiscard: () => void;
}>;

/**
 * The lightbox's guard: `guard(action)` runs a step, a thumbnail pick or the close at once when no
 * draft differs from its saved value, and otherwise holds it until the dialog answers. Back and
 * links go through the same dialog.
 */
export function useLightboxDraftsGuard() {
  const drafts = useUnsavedDrafts();
  const { dirtyFields, blocker } = useDraftsLeaveGuard(drafts);
  const [pending, setPending] = useState<{ run: () => void } | null>(null);
  // A save that lands while the question is open leaves nothing to ask about: forget the step too,
  // or the dialog would come back with the next edit.
  const dirty = dirtyFields.length > 0;
  useEffect(() => {
    if (!dirty) setPending(null);
  }, [dirty]);

  const guard = useCallback(
    (action: () => void) => {
      if (drafts.dirtyFields().length === 0) action();
      // A second key press while the question is open does not replace the first.
      else setPending(current => current ?? { run: action });
    },
    [drafts]
  );

  const blocked = blocker.status === "blocked";
  const dialog: DraftsDialog = {
    opened: (pending !== null || blocked) && dirty,
    fields: dirtyFields,
    onKeepEditing: () => {
      setPending(null);
      blocker.reset?.();
    },
    onDiscard: () => {
      drafts.discardAll();
      setPending(null);
      if (blocked) blocker.proceed?.();
      else pending?.run();
    },
  };

  return { drafts, guard, dialog };
}
