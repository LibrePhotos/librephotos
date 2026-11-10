import { autoUpdate, computePosition, flip, offset, shift, type VirtualElement } from "@floating-ui/dom";
import classes from "./suggestionPopup.module.css";

/** Space between the caret and the popup. */
const GAP_PX = 10;
/** How close the popup may come to a viewport edge before it flips or shifts. */
const EDGE_PX = 5;

export type SuggestionPopup = {
  /** Anchor to a new caret rect getter (the plugin hands a fresh one with each update). */
  reanchor: (getRect: () => DOMRect) => void;
  /** Hide until destroyed; a later reanchor keeps it hidden. */
  hide: () => void;
  /** Stop following the caret and take the popup out of the page. */
  destroy: () => void;
};

/**
 * Shows `content` on document.body, below the caret (`getRect`) and aligned with its left edge,
 * flipped above it or shifted sideways where the viewport has no room. It follows the caret while
 * the page or a scroll container of `contextElement` scrolls or resizes. A press anywhere outside it
 * hides it, as a press inside the editor moves the caret away from the `#`.
 */
export function openSuggestionPopup(
  content: HTMLElement,
  getRect: () => DOMRect,
  contextElement?: Element
): SuggestionPopup {
  const popup = document.createElement("div");
  popup.className = classes.popup ?? "";
  popup.appendChild(content);
  document.body.appendChild(popup);

  let anchor = getRect;
  const reference: VirtualElement = { getBoundingClientRect: () => anchor(), contextElement };
  let open = true;

  const place = () => {
    void computePosition(reference, popup, {
      strategy: "fixed",
      placement: "bottom-start",
      middleware: [offset(GAP_PX), flip({ padding: EDGE_PX }), shift({ padding: EDGE_PX })],
    }).then(({ x, y }) => {
      // A position computed before the popup was hidden or removed lands after it.
      if (!open) return;
      popup.style.left = `${x}px`;
      popup.style.top = `${y}px`;
    });
  };
  const stopFollowing = autoUpdate(reference, popup, place);

  const onPress = (event: MouseEvent) => {
    if (event.target instanceof Node && popup.contains(event.target)) return;
    hide();
  };
  // A tap fires a mousedown too, a scroll gesture does not, so scrolling on a phone keeps it open.
  document.addEventListener("mousedown", onPress, true);

  function hide() {
    if (!open) return;
    open = false;
    popup.hidden = true;
    stopFollowing();
    document.removeEventListener("mousedown", onPress, true);
  }

  return {
    reanchor: next => {
      anchor = next;
      if (open) place();
    },
    hide,
    destroy: () => {
      hide();
      popup.remove();
    },
  };
}
