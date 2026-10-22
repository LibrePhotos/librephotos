import { useReducedMotion } from "@mantine/hooks";
import type React from "react";
import { useCallback, useEffect, useRef, useState } from "react";

/** How long the pointer rests on a tile before its clip mounts, so passing over a row loads nothing. */
export const PREVIEW_DELAY_MS = 250;

type PreviewHandlers = Required<
  Pick<React.DOMAttributes<HTMLElement>, "onPointerEnter" | "onPointerLeave" | "onFocus" | "onBlur">
>;

// A tap focuses the button too; only keyboard focus starts a preview, as hover does for a mouse.
function isKeyboardFocus(target: EventTarget): boolean {
  try {
    return target instanceof Element && target.matches(":focus-visible");
  } catch {
    return false;
  }
}

/**
 * Whether a video tile with a poster shows its clip (#2026): after the pointer has rested on the
 * tile for `PREVIEW_DELAY_MS`, or while it has keyboard focus, until the pointer leaves or focus
 * moves out. Touch never previews (a tap opens the lightbox), and neither does anything with
 * `prefers-reduced-motion`. Spread `handlers` on the element around the tile.
 */
export function useClipPreview(enabled: boolean): { previewing: boolean; handlers: PreviewHandlers } {
  const reducedMotion = useReducedMotion();
  const active = enabled && !reducedMotion;
  const [previewing, setPreviewing] = useState(false);
  const timer = useRef<number | undefined>(undefined);

  const start = useCallback(() => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setPreviewing(true), PREVIEW_DELAY_MS);
  }, []);
  const stop = useCallback(() => {
    window.clearTimeout(timer.current);
    setPreviewing(false);
  }, []);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  const handlers: PreviewHandlers = {
    onPointerEnter: event => {
      if (active && event.pointerType !== "touch") start();
    },
    onPointerLeave: stop,
    onFocus: event => {
      if (active && isKeyboardFocus(event.target)) start();
    },
    onBlur: event => {
      if (!(event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget))) stop();
    },
  };
  return { previewing: active && previewing, handlers };
}
