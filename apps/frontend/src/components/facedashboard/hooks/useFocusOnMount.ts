import { useEffect, useEffectEvent, useRef } from "react";

/**
 * Folding or unfolding a person swaps their cell (#860): the collapsed person's button and the
 * expanded person's header are different elements in different rows, so the control that was
 * clicked is gone. When `active` as it mounts, the new element takes focus and reports it with
 * `onFocused`, so a keyboard user stays on the person instead of falling back to the page. Only
 * on mount: the element that was clicked is still there until the fold lands, and must not take
 * the request.
 */
export function useFocusOnMount<T extends HTMLElement>(active: boolean, onFocused: () => void) {
  const ref = useRef<T>(null);
  const focusIfAsked = useEffectEvent(() => {
    if (!active || !ref.current) return;
    ref.current.focus();
    onFocused();
  });
  useEffect(() => {
    focusIfAsked();
  }, []);
  return ref;
}
