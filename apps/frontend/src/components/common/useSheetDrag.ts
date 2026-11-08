import type React from "react";
import { useRef } from "react";

/** How far down a drag must go, or how fast, to close a sheet. */
const CLOSE_DISTANCE = 80;
const CLOSE_SPEED = 0.5; // px per ms

type DragHandlers = Readonly<{
  onPointerDown: (event: React.PointerEvent<HTMLElement>) => void;
  onPointerMove: (event: React.PointerEvent<HTMLElement>) => void;
  onPointerUp: (event: React.PointerEvent<HTMLElement>) => void;
  onPointerCancel: (event: React.PointerEvent<HTMLElement>) => void;
}>;

/**
 * Drag-down-to-close for a phone sheet: spread the handlers on its handle and heading. While the
 * finger moves, the sheet follows it through `--sheet-drag` (the sheet's CSS sets
 * `translate: 0 var(--sheet-drag, 0px)`); a long or fast drag closes it, a short one springs back.
 * A drag that starts on a button is left to the button.
 */
export function useSheetDrag<T extends HTMLElement>(onClose: () => void) {
  const sheet = useRef<T>(null);
  const drag = useRef<{ startY: number; startTime: number; dy: number } | null>(null);

  const setOffset = (dy: number) => sheet.current?.style.setProperty("--sheet-drag", `${dy}px`);

  const end = (event: React.PointerEvent<HTMLElement>) => {
    const current = drag.current;
    drag.current = null;
    if (!current) return;
    const speed = current.dy / Math.max(1, event.timeStamp - current.startTime);
    if (current.dy > CLOSE_DISTANCE || (current.dy > 16 && speed > CLOSE_SPEED)) {
      onClose();
      return;
    }
    // Spring back. A Mantine transition may own the inline `transition`, so animate it here.
    setOffset(0);
    sheet.current?.animate([{ translate: `0 ${current.dy}px` }, { translate: "0 0" }], {
      duration: 180,
      easing: "ease-out",
    });
  };

  const handlers: DragHandlers = {
    onPointerDown: event => {
      if (event.target instanceof Element && event.target.closest("button")) return;
      drag.current = { startY: event.clientY, startTime: event.timeStamp, dy: 0 };
      event.currentTarget.setPointerCapture(event.pointerId);
    },
    onPointerMove: event => {
      if (!drag.current) return;
      // Down only: pulling up has nowhere to go.
      drag.current.dy = Math.max(0, event.clientY - drag.current.startY);
      setOffset(drag.current.dy);
    },
    onPointerUp: end,
    onPointerCancel: end,
  };

  return { sheet, handlers, reset: () => setOffset(0) };
}
