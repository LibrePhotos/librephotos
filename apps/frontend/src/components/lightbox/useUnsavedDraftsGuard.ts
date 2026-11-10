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
 * What the dialog asks about: a step the lightbox holds (an arrow, a stack photo, the close, a
 * trash), or a navigation the router holds (Back, a link). One at a time: a navigation is the
 * user's latest way off the photo, so it replaces a held step, which is dropped with it.
 */
type Question = Readonly<{ about: "step"; run: () => void }> | Readonly<{ about: "navigation" }>;

/**
 * The lightbox's guard: `guard(action)` runs a step, a thumbnail pick, the close or a trash at once
 * when no draft differs from its saved value, and otherwise holds it until the dialog answers. Back
 * and links go through the same dialog. A save that lands while it asks leaves nothing to lose, so
 * whatever was asked about goes ahead, a held step as much as a held Back.
 */
export function useLightboxDraftsGuard() {
  const drafts = useUnsavedDrafts();
  const { dirtyFields, blocker } = useDraftsLeaveGuard(drafts);
  const [heldStep, setHeldStep] = useState<{ run: () => void } | null>(null);
  const blocked = blocker.status === "blocked";
  const question: Question | null = blocked
    ? { about: "navigation" }
    : heldStep && { about: "step", run: heldStep.run };

  const dirty = dirtyFields.length > 0;
  useEffect(() => {
    if (dirty || heldStep === null) return;
    setHeldStep(null);
    // A held navigation is let go by useDraftsLeaveGuard, and replaces the step.
    if (!blocked) heldStep.run();
  }, [dirty, heldStep, blocked]);

  const guard = useCallback(
    (action: () => void) => {
      if (drafts.dirtyFields().length === 0) action();
      // A second key press while the question is open does not replace the first.
      else setHeldStep(current => current ?? { run: action });
    },
    [drafts]
  );

  const answer = (discard: boolean) => {
    setHeldStep(null);
    if (question === null) return;
    if (discard) drafts.discardAll();
    switch (question.about) {
      case "navigation":
        if (discard) blocker.proceed?.();
        else blocker.reset?.();
        return;
      case "step":
        if (discard) question.run();
        return;
    }
  };

  const dialog: DraftsDialog = {
    opened: question !== null && dirty,
    fields: dirtyFields,
    onKeepEditing: () => answer(false),
    onDiscard: () => answer(true),
  };

  return { drafts, guard, dialog };
}
