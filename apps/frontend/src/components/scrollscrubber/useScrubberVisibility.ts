import { throttle } from "lodash-es";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { RefObject } from "react";

const HIDE_AFTER_MS = 2500;
// A scroll of more than this many pixels within a second shows the scrubber.
const LONG_SCROLL_PX = 600;

/**
 * Whether the scrubber is shown: from pointing at it or a long scroll, until 2.5 s after the last
 * of those. It stays up while `draggingRef` says the thumb is held.
 */
export function useScrubberVisibility(draggingRef: RefObject<boolean>) {
  const [visible, setVisible] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const previousScroll = useRef(Number.NaN);

  const hide = useCallback(
    function hideScrubber() {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = null;
      if (draggingRef.current) {
        timerRef.current = setTimeout(hideScrubber, HIDE_AFTER_MS);
        return;
      }
      setVisible(false);
    },
    [draggingRef]
  );

  // Restarts the countdown, at most once a second.
  const keepShowing = useMemo(
    () =>
      throttle(() => {
        if (timerRef.current) {
          clearTimeout(timerRef.current);
          timerRef.current = setTimeout(hide, HIDE_AFTER_MS);
        }
      }, 1000),
    [hide]
  );

  // Changes only with `visible`: the timers it calls are stable.
  const show = useCallback(() => {
    if (visible) {
      keepShowing();
      return;
    }
    setVisible(true);
    timerRef.current ??= setTimeout(hide, HIDE_AFTER_MS);
  }, [visible, keepShowing, hide]);

  // A new throttle only when `visible` changes, through `show`.
  const noteScroll = useMemo(
    () =>
      throttle((y: number) => {
        if (!Number.isNaN(previousScroll.current) && Math.abs(previousScroll.current - y) > LONG_SCROLL_PX) show();
        previousScroll.current = y;
      }, 1000),
    [show]
  );

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = null;
    },
    []
  );

  return { visible, show, keepShowing, noteScroll };
}
