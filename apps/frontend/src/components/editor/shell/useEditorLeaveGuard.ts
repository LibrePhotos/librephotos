import { useBlocker } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { useBeforeUnloadWarning } from "../../../hooks/useBeforeUnloadWarning";

/** What the unsaved-changes dialog asks about: closing the editor, or a navigation the router holds. */
type Question = "close" | "navigation";

/**
 * Leaving the editor with changes that are not saved: its close (and Escape), Back or a link, a
 * reload or a closed tab. `requestClose` closes at once when nothing is unsaved and asks otherwise;
 * the browser asks about a reload itself. `answer` resolves the question: discard leaves, keep stays,
 * and a save that went through leaves too.
 */
export function useEditorLeaveGuard(dirty: boolean, onClose: () => void) {
  const dirtyNow = useRef(dirty);
  useEffect(() => {
    dirtyNow.current = dirty;
  });
  useBeforeUnloadWarning(dirty);
  const blocker = useBlocker({
    shouldBlockFn: () => dirtyNow.current,
    enableBeforeUnload: false,
    disabled: !dirty,
    withResolver: true,
  });
  const [closing, setClosing] = useState(false);
  const blocked = blocker.status === "blocked";
  const question: Question | null = blocked ? "navigation" : closing ? "close" : null;

  const requestClose = useCallback(() => {
    if (dirtyNow.current) setClosing(true);
    else onClose();
  }, [onClose]);

  const { proceed, reset } = blocker;
  const leave = useCallback(() => {
    setClosing(false);
    if (blocked) proceed?.();
    else onClose();
  }, [blocked, proceed, onClose]);
  const stay = useCallback(() => {
    setClosing(false);
    if (blocked) reset?.();
  }, [blocked, reset]);

  return { question, requestClose, leave, stay };
}
