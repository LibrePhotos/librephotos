import { debounce } from "lodash-es";
import { useEffect, useMemo, useState } from "react";
import type { RefObject } from "react";

type Options = Readonly<{
  /** The element around the scroll target (the scrubber's root). */
  rootRef: RefObject<HTMLElement | null>;
  /** The bar a window-scrolling page scrolls under; see ScrollScrubber's `stickyHeader`. */
  stickyHeader: RefObject<HTMLElement | null> | undefined;
  /** The scrubber's own size: a change means the window was resized. */
  width: number;
  height: number;
  /** Height of the scroll target. */
  targetHeight: number;
}>;

type Geometry = {
  /** Where the scrubber starts, in pixels from the top of the window. */
  offsetTop: number;
  /** The height the target is seen through: the window, less the sticky header above it. */
  viewportHeight: number;
  /** How far the page scrolls before the target reaches the sticky header (a banner above it). */
  scrollOffset: number;
  /** How far the page (with a sticky header: the window) can scroll; 0 when everything fits. */
  scrollRange: number;
};

/**
 * Where the scrubber sits and the scroll range it stands for, measured 500 ms after the window,
 * the sticky header or the page last changed size.
 *
 * With a sticky header the scrubber runs from the header's bottom edge to the bottom of the window,
 * however far the page has scrolled: a banner above the target (the timeline's memories) only
 * moves where the target starts in the page's scroll range. Without one it starts at the nearest
 * ancestor that is offset from the top, for targets that scroll themselves (the faces grid).
 */
export function useScrubberGeometry({ rootRef, stickyHeader, width, height, targetHeight }: Options): Geometry {
  const [offsetTop, setOffsetTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);
  const [scrollOffset, setScrollOffset] = useState(0);
  // The window's own scroll range, read with a sticky header. Exact, where the target height can
  // lag a render behind while the grid lays out the days it loads.
  const [windowScrollRange, setWindowScrollRange] = useState<number | null>(null);

  const measure = useMemo(
    () =>
      debounce(() => {
        const header = stickyHeader?.current;
        const root = rootRef.current;
        if (header && root) {
          const headerBottom = header.getBoundingClientRect().bottom;
          setOffsetTop(headerBottom);
          setViewportHeight(window.innerHeight - headerBottom);
          setScrollOffset(Math.max(root.getBoundingClientRect().top + window.scrollY - headerBottom, 0));
          setWindowScrollRange(Math.max(document.documentElement.scrollHeight - window.innerHeight, 0));
          return;
        }
        setWindowScrollRange(null);
        setViewportHeight(window.innerHeight);
        let element = root;
        while (element) {
          if (element.offsetTop !== 0) {
            setOffsetTop(element.offsetTop);
            break;
          }
          element = element.parentElement;
        }
      }, 500),
    [rootRef, stickyHeader]
  );

  useEffect(() => {
    measure();
  }, [measure, width, height, targetHeight]);

  useEffect(() => {
    window.addEventListener("resize", measure);
    // The header grows with the selection bar, the grid with the days it loads, and the page
    // (the root's parent) with a banner that loads after the grid.
    const header = stickyHeader?.current;
    const root = rootRef.current;
    const observer = header && root && "ResizeObserver" in window ? new ResizeObserver(() => measure()) : null;
    if (observer && header && root) {
      observer.observe(header);
      observer.observe(root);
      if (root.parentElement) observer.observe(root.parentElement);
    }
    return () => {
      window.removeEventListener("resize", measure);
      observer?.disconnect();
      measure.cancel();
    };
  }, [measure, stickyHeader, rootRef]);

  return {
    offsetTop,
    viewportHeight,
    scrollOffset,
    scrollRange: windowScrollRange ?? Math.max(scrollOffset + targetHeight - viewportHeight, 0),
  };
}
