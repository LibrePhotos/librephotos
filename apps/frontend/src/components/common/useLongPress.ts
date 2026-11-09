import type React from "react";
import { useEffect, useRef } from "react";

/** How long a finger rests on a card before its menu opens, as on Android and iOS. */
const LONG_PRESS_MS = 500;
/** How far the finger may drift (px) and still be a press rather than a scroll. */
const MOVE_TOLERANCE = 10;
/** How long after a long press its release's click and context menu still belong to it. */
const RELEASE_MS = 1000;

type LongPressHandlers = Readonly<{
  onPointerDown: (event: React.PointerEvent) => void;
  onPointerMove: (event: React.PointerEvent) => void;
  onPointerUp: () => void;
  onPointerCancel: () => void;
  onContextMenu: (event: React.MouseEvent) => void;
}>;

/**
 * Whether the event comes from the element's own DOM: React passes events from a portal (an open
 * menu's dropdown) up to it too, and a press there is not one on the card.
 */
const fromInside = (event: React.SyntheticEvent) =>
  event.target instanceof Node && event.currentTarget.contains(event.target);

/**
 * Swallows the click the finger's release makes, wherever it lands: on the card's link, or on the
 * item of the menu that opened under the finger. A new press ends it.
 */
function swallowReleaseClick() {
  const swallow = (event: MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    done();
  };
  const done = () => {
    window.clearTimeout(timeout);
    window.removeEventListener("click", swallow, true);
    window.removeEventListener("pointerdown", done, true);
  };
  window.addEventListener("click", swallow, true);
  window.addEventListener("pointerdown", done, true);
  const timeout = window.setTimeout(done, RELEASE_MS);
}

/**
 * A touch long-press (review r6 #16): after 500ms held still it buzzes (where the phone can) and
 * calls `onLongPress`. The click that the release would make is swallowed, and so is the browser's
 * own long-press menu for the link. Mouse and keyboard are left alone.
 */
export function useLongPress(onLongPress: () => void): LongPressHandlers {
  const timer = useRef<number | null>(null);
  const origin = useRef<{ x: number; y: number } | null>(null);
  // When the current touch opened the menu (ms): the context menu it raises is swallowed
  const firedAt = useRef<number | null>(null);
  const justFired = () => firedAt.current !== null && Date.now() - firedAt.current < RELEASE_MS;

  const cancel = () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
    origin.current = null;
  };
  const fire = () => {
    cancel();
    if (justFired()) return;
    firedAt.current = Date.now();
    swallowReleaseClick();
    if ("vibrate" in navigator) navigator.vibrate(10);
    onLongPress();
  };

  useEffect(() => cancel, []);

  return {
    onPointerDown: event => {
      if (!fromInside(event)) return;
      firedAt.current = null;
      if (event.pointerType !== "touch") return;
      origin.current = { x: event.clientX, y: event.clientY };
      timer.current = window.setTimeout(fire, LONG_PRESS_MS);
    },
    onPointerMove: event => {
      const start = origin.current;
      if (start && Math.hypot(event.clientX - start.x, event.clientY - start.y) > MOVE_TOLERANCE) cancel();
    },
    onPointerUp: cancel,
    onPointerCancel: cancel,
    // Android raises the context menu itself on a long press: it opens ours instead
    onContextMenu: event => {
      if (!fromInside(event) || (origin.current === null && !justFired())) return;
      event.preventDefault();
      fire();
    },
  };
}
