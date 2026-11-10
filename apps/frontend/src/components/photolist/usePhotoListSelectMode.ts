import { useHotkeys } from "@mantine/hooks";
import { useEffect, useRef } from "react";
import { isSelecting } from "./photoListSelection";
import type { ListSelection, SelectionEvent } from "./photoListSelection";

// An Escape meant for an open menu, dialog or popover closes that, not select mode.
function insideOverlay(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest('[role="dialog"], [role="menu"], [role="listbox"]') !== null;
}

// Focus left with the bar (its ✕, an action that cleared the selection) and is on nothing.
function focusWasDropped(): boolean {
  const active = document.activeElement;
  return active === null || active === document.body || !active.isConnected;
}

/**
 * Select mode of a photo list (#2240): the header's Select button turns it on, and the selection
 * bar shows only while selecting. The bar's ✕, Escape and the Select button again leave it,
 * clearing the selection.
 *
 * Focus follows the bar: the Select button hands it to the bar's ✕, and when the bar goes away
 * with focus inside it, focus goes back to the Select button instead of the top of the page.
 */
export function usePhotoListSelectMode(
  selection: ListSelection,
  dispatch: (event: SelectionEvent) => void,
  escapeEnabled: boolean
) {
  const selecting = isSelecting(selection);
  const selectButtonRef = useRef<HTMLButtonElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  // Set by the Select button: the bar that opens next takes focus.
  const focusBar = useRef(false);
  const wasSelecting = useRef(selecting);

  const exit = () => dispatch({ type: "clear" });
  const toggle = () => {
    if (selecting) {
      exit();
      return;
    }
    focusBar.current = true;
    dispatch({ type: "enter" });
  };

  useEffect(() => {
    if (selecting && focusBar.current) closeButtonRef.current?.focus();
    if (!selecting && wasSelecting.current && focusWasDropped()) selectButtonRef.current?.focus();
    focusBar.current = false;
    wasSelecting.current = selecting;
  }, [selecting]);

  useHotkeys([
    [
      "Escape",
      event => {
        if (selecting && escapeEnabled && !insideOverlay(event.target)) exit();
      },
    ],
  ]);

  return { selecting, toggle, exit, selectButtonRef, closeButtonRef };
}
