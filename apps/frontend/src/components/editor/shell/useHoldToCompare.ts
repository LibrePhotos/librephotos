import type React from "react";
import { useEffect, useRef } from "react";

/**
 * A button that shows the original while it is held: pressed by pointer (mouse, pen, touch) or by
 * Space or Enter, released when the press ends or leaves it. Spread the result on the button.
 */
export function useHoldToCompare(onCompare: (holding: boolean) => void) {
  const latest = useRef(onCompare);
  useEffect(() => {
    latest.current = onCompare;
  });
  const hold = () => latest.current(true);
  const release = () => latest.current(false);
  const isKey = (event: React.KeyboardEvent) => event.key === " " || event.key === "Enter";
  return {
    onPointerDown: (event: React.PointerEvent<HTMLButtonElement>) => {
      event.currentTarget.setPointerCapture(event.pointerId);
      hold();
    },
    onPointerUp: release,
    onPointerCancel: release,
    onLostPointerCapture: release,
    onBlur: release,
    onKeyDown: (event: React.KeyboardEvent<HTMLButtonElement>) => {
      if (!isKey(event) || event.repeat) return;
      event.preventDefault();
      hold();
    },
    onKeyUp: (event: React.KeyboardEvent<HTMLButtonElement>) => {
      if (!isKey(event)) return;
      event.preventDefault();
      release();
    },
    // A press with the context menu (a long touch) must not open it over the photo.
    onContextMenu: (event: React.MouseEvent) => event.preventDefault(),
  };
}
