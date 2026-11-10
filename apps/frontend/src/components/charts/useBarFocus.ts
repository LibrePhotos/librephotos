import type React from "react";
import { useCallback, useRef, useState } from "react";

/**
 * Which bar of a chart is shown in its tooltip, and how the user gets there: pointing at it, tapping
 * it, or the keyboard. The bars are one tab stop (a roving tabindex): Tab enters on the bar last
 * shown, the arrow keys step through them, Home and End jump to the ends, Escape hides the tooltip.
 */
export function useBarFocus(count: number) {
  const [active, setActive] = useState<number | null>(null);
  // The bar that takes the tab stop: the last one shown, the first one before that
  const [current, setCurrent] = useState(0);
  const bars = useRef(new Map<number, SVGElement>());

  const show = useCallback((index: number | null) => {
    setActive(index);
    if (index !== null) setCurrent(index);
  }, []);

  const focusBar = (index: number) => {
    const next = Math.min(count - 1, Math.max(0, index));
    bars.current.get(next)?.focus();
  };

  const onKeyDown = (event: React.KeyboardEvent, index: number) => {
    const target: Record<string, number> = {
      ArrowRight: index + 1,
      ArrowUp: index + 1,
      ArrowLeft: index - 1,
      ArrowDown: index - 1,
      Home: 0,
      End: count - 1,
    };
    const next = target[event.key];
    if (next !== undefined) {
      event.preventDefault();
      focusBar(next);
    } else if (event.key === "Escape") {
      setActive(null);
    }
  };

  /** What a bar element needs: its ref, its place in the tab order, focus and key handling. */
  const barProps = (index: number) => ({
    ref: (element: SVGElement | null) => {
      if (element) bars.current.set(index, element);
      else bars.current.delete(index);
    },
    tabIndex: index === Math.min(current, count - 1) ? 0 : -1,
    onFocus: () => show(index),
    onBlur: () => setActive(null),
    onKeyDown: (event: React.KeyboardEvent) => onKeyDown(event, index),
  });

  return { active: active !== null && active < count ? active : null, show, barProps };
}
