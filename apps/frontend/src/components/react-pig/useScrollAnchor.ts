import { useCallback, useLayoutEffect, useRef } from "react";
import type React from "react";
import { anchorShift, findScrollAnchor } from "./scrollAnchor";
import type { ImageItem, PigEntry, PigLayout } from "./types";

type LayoutRefs<T extends ImageItem> = {
  containerRef: React.RefObject<HTMLDivElement | null>;
  /** The scroll offset Pig picks the rendered tiles for. */
  latestYOffsetRef: React.RefObject<number>;
  /** The layout the grid renders from. */
  layoutRef: React.RefObject<PigLayout<T> | null>;
  /** The entries Pig hands out through its ref. */
  imageDataRef: React.RefObject<PigEntry<T>[]>;
};

// The entries of a layout, as Pig keeps them in imageDataRef and hands them out
// through its ref: the layout's own array, so sorting one sorts the other.
function entriesOf<T extends ImageItem>(layout: PigLayout<T>): PigEntry<T>[] {
  return layout.grouped ? layout.groups : layout.tiles;
}

/**
 * Pig's `storeLayout`: keeps a new layout, and the entries it placed, in the refs, and keeps the
 * reader's place. A new layout moves the tiles (a day's page arrives, the width changes); the page
 * scrolls by as much as the tile at the top of the screen moved, once the new tiles are rendered
 * (`renderedItems` changes) and before the browser paints them. Scrolling earlier showed the old
 * tiles moved for a frame. `latestYOffsetRef` gets the offset the page will have, so the tiles Pig
 * renders are the ones on screen after the scroll.
 */
export function useScrollAnchoredLayout<T extends ImageItem>(refs: LayoutRefs<T>, renderedItems: PigLayout<T>) {
  const { containerRef, latestYOffsetRef, layoutRef, imageDataRef } = refs;
  const pendingScrollRef = useRef(0);

  useLayoutEffect(() => {
    const shift = pendingScrollRef.current;
    if (shift === 0) return;
    pendingScrollRef.current = 0;
    window.scrollBy({ top: shift, behavior: "instant" });
  }, [renderedItems]);

  return useCallback(
    (layout: PigLayout<T> | null) => {
      const previous = layoutRef.current;
      const container = containerRef.current;
      if (previous && layout && container) {
        const anchor = findScrollAnchor(previous, window.scrollY - container.offsetTop);
        const shift = anchor ? anchorShift(layout, anchor) : 0;
        if (Math.abs(shift) >= 1) {
          pendingScrollRef.current += shift;
          latestYOffsetRef.current = window.scrollY + pendingScrollRef.current;
        }
      }
      layoutRef.current = layout;
      if (layout) imageDataRef.current = entriesOf(layout);
    },
    [containerRef, latestYOffsetRef, layoutRef, imageDataRef]
  );
}
