import { useDebouncedCallback } from "@mantine/hooks";
import type { RefObject } from "react";
import { useEffect } from "react";

/**
 * Calls `onResize` when the grid needs a new layout or a new render window: after the window
 * resizes (debounced; its height decides which tiles render), and when the grid element changes
 * width without a window resize (the sidebar, a side panel, a scrollbar appearing). The width check
 * runs at most once a frame and ignores height changes (Pig sets the element's height itself) and
 * a hidden, 0px wide element, which keeps its layout.
 */
export function useGridResize(ref: RefObject<HTMLElement | null>, onResize: () => void): void {
  const debouncedResize = useDebouncedCallback(onResize, 500);

  useEffect(() => {
    window.addEventListener("resize", debouncedResize);
    return () => window.removeEventListener("resize", debouncedResize);
  }, [debouncedResize]);

  useEffect(() => {
    const element = ref.current;
    if (!element || typeof ResizeObserver === "undefined") return undefined;
    let laidOutWidth = element.offsetWidth;
    let frame = 0;
    const observer = new ResizeObserver(() => {
      if (frame) return;
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        const width = element.offsetWidth;
        if (width === 0 || width === laidOutWidth) return;
        laidOutWidth = width;
        onResize();
      });
    });
    observer.observe(element);
    return () => {
      observer.disconnect();
      window.cancelAnimationFrame(frame);
    };
  }, [ref, onResize]);
}
