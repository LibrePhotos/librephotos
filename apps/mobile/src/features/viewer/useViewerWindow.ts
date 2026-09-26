/**
 * The viewer's pager context: a *window* of the timeline around the tapped
 * photo, not the timeline itself.
 *
 * The old shape was `timelinePage(db, { limit: 500 })` in a live query, run
 * synchronously on mount. Three separate costs came out of that:
 *
 *  1. the merged timeline query had no limit inside its UNION arms, so SQLite
 *     read and sorted the whole library to hand back 500 rows (see
 *     `db/queries/timeline.ts`);
 *  2. 500 rows were marshalled into JS objects and 500 filmstrip tiles mounted,
 *     all before the first frame;
 *  3. it was reactive, so every database commit during a camera-roll scan re-ran
 *     the lot underneath a finger that was trying to swipe.
 *
 * All three are gone. The window is anchored on the tapped photo with a keyset
 * cursor, holds ~40 slides, extends by a page when a swipe approaches either
 * edge, and is *not* reactive — a viewer is opened at one photo and paged from
 * there, so the pager context is deliberately frozen for the life of the screen.
 * Photo-level state (favourite, rating, caption) stays live; only the list of
 * slides is fixed.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useDb } from "@/db/provider";
import { viewerSlideById, type ViewerSlide } from "@/db/queries/detail";
import { timelineCursorFor, timelinePage, type TimelineCursor } from "@/db/queries/timeline";
import type { MergedTimelineRow } from "@/db/types";

/** Slides loaded either side of the tapped photo. */
const HALF = 20;
/** Slides added each time a swipe approaches an edge. */
const EXTEND = 20;
/** How close to an edge a swipe gets before the window extends. */
const EDGE = 6;

export type ViewerWindow = {
  slides: ViewerSlide[];
  /** True once the newest / oldest end of the timeline is in the window. */
  atStart: boolean;
  atEnd: boolean;
  /**
   * Set when slides were added *before* the current one, which shifts every
   * index. The pager must re-anchor to this index and then call `restored`.
   */
  restoreIndex: number | null;
  restored: () => void;
};

type State = {
  slides: ViewerSlide[];
  /** Keyset cursor for loading further towards the newest photo. */
  head: TimelineCursor | null;
  /** Keyset cursor for loading further into the past. */
  tail: TimelineCursor | null;
  atStart: boolean;
  atEnd: boolean;
  restoreIndex: number | null;
};

export function rowToSlide(r: MergedTimelineRow): ViewerSlide {
  return {
    key: (r.remote_id ?? r.local_id ?? r.image_hash) as string,
    remote_id: r.remote_id,
    local_id: r.local_id,
    image_hash: r.image_hash,
    local_uri: r.local_uri,
    type: r.type,
  };
}

/** Does this slide answer to the given route param? */
export function matchesId(slide: ViewerSlide, id: string): boolean {
  return (
    slide.key === id || slide.remote_id === id || slide.local_id === id || slide.image_hash === id
  );
}

export function useViewerWindow({
  id,
  seed,
  currentIndex,
}: {
  id: string;
  /** What the tapping screen already knew — painted before any query runs. */
  seed: ViewerSlide | null;
  /** Index of the slide the user is on, so the window knows where to grow. */
  currentIndex: number;
}): ViewerWindow {
  const db = useDb();

  // First frame: the seed if the caller gave us one, otherwise one indexed
  // row lookup. Either way this is O(1) and never touches the timeline.
  const [state, setState] = useState<State>(() => {
    const first = seed ?? (id ? viewerSlideById(db, id) : null);
    return {
      slides: first ? [first] : [],
      head: null,
      tail: null,
      atStart: false,
      atEnd: false,
      restoreIndex: null,
    };
  });

  // Guards the extension effect against re-entering with a cursor it has
  // already spent (React re-runs effects, and a page can arrive mid-swipe).
  const spent = useRef<Set<string>>(new Set());

  /* ---- the window itself, one frame after the photo ------------------- */

  useEffect(() => {
    const anchor = id ? timelineCursorFor(db, id) : null;
    if (!anchor) {
      // Not in the timeline at all: a hidden photo, a trashed one, a deep link
      // to something outside the visible set. One slide is the whole context.
      setState((s) => ({ ...s, atStart: true, atEnd: true }));
      return;
    }
    const older = timelinePage(db, {
      limit: HALF + 1,
      cursor: anchor,
      direction: "older",
      inclusive: true,
    });
    const newer = timelinePage(db, { limit: HALF, cursor: anchor, direction: "newer" });
    const slides = [...newer.rows, ...older.rows].map(rowToSlide);
    if (slides.length === 0) {
      setState((s) => ({ ...s, atStart: true, atEnd: true }));
      return;
    }
    const anchorIndex = Math.max(
      0,
      slides.findIndex((s) => matchesId(s, id))
    );
    spent.current = new Set();
    setState({
      slides,
      head: newer.nextCursor,
      tail: older.nextCursor,
      atStart: newer.nextCursor == null,
      atEnd: older.nextCursor == null,
      restoreIndex: anchorIndex,
    });
  }, [db, id]);

  /* ---- extension ------------------------------------------------------ */

  useEffect(() => {
    const { slides, tail, head, atEnd, atStart, restoreIndex } = state;
    if (slides.length === 0) return;
    // The pager has not acknowledged where it is yet (it still has to re-anchor
    // on `restoreIndex`), so `currentIndex` describes the *old* window. Growing
    // on it would extend from the wrong end — the window opens with the tapped
    // photo in the middle, but the pager reports index 0 until it has moved.
    if (restoreIndex != null) return;

    const nearEnd = currentIndex >= slides.length - 1 - EDGE;
    const nearStart = currentIndex <= EDGE;

    if (nearEnd && !atEnd && tail && !spent.current.has(key("older", tail))) {
      spent.current.add(key("older", tail));
      const page = timelinePage(db, { limit: EXTEND, cursor: tail, direction: "older" });
      setState((s) =>
        s.tail !== tail
          ? s
          : {
              ...s,
              slides: [...s.slides, ...page.rows.map(rowToSlide)],
              tail: page.nextCursor,
              atEnd: page.nextCursor == null,
            }
      );
      return;
    }

    if (nearStart && !atStart && head && !spent.current.has(key("newer", head))) {
      spent.current.add(key("newer", head));
      const page = timelinePage(db, { limit: EXTEND, cursor: head, direction: "newer" });
      const added = page.rows.length;
      setState((s) =>
        s.head !== head
          ? s
          : {
              ...s,
              slides: [...page.rows.map(rowToSlide), ...s.slides],
              head: page.nextCursor,
              atStart: page.nextCursor == null,
              // Everything shifted right by `added`; the pager must follow.
              restoreIndex: added > 0 ? currentIndex + added : s.restoreIndex,
            }
      );
    }
  }, [db, state, currentIndex]);

  const restored = useCallback(() => {
    setState((s) => (s.restoreIndex == null ? s : { ...s, restoreIndex: null }));
  }, []);

  return {
    slides: state.slides,
    atStart: state.atStart,
    atEnd: state.atEnd,
    restoreIndex: state.restoreIndex,
    restored,
  };
}

function key(direction: string, cursor: TimelineCursor): string {
  return `${direction}:${cursor.timestamp}:${cursor.sortId}`;
}
