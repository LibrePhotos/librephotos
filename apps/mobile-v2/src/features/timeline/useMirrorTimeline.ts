import { useCallback, useState } from "react";
import { useReactiveQuery } from "@/db/provider";
import { timelinePage } from "@/db/queries/timeline";
import type { MergedTimelineRow } from "@/db/types";
import type { TimelineItem } from "@/components/TimelineList";

const PAGE = 120;

export function rowToItem(r: MergedTimelineRow): TimelineItem {
  return {
    key: (r.remote_id ?? r.local_id ?? r.image_hash) as string,
    photoId: r.remote_id,
    imageHash: r.image_hash,
    type: r.type,
    dominantColor: r.dominant_color,
    localUri: r.local_uri,
    day: r.bucket_day,
  };
}

/**
 * Reactive, growing-window timeline over the mirror. The visible window
 * (`limit`) re-queries from the top on every DB commit (live query) and grows
 * by a page on scroll. Keyset pagination is available in the query layer for a
 * future windowed refinement; a growing window keeps Phase 1 simple + reactive.
 */
export function useMirrorTimeline() {
  const [limit, setLimit] = useState(PAGE);
  const items = useReactiveQuery(
    (db) => timelinePage(db, { limit }).rows.map(rowToItem),
    [limit]
  );
  const loadMore = useCallback(() => {
    if (items.length >= limit) setLimit((n) => n + PAGE);
  }, [items.length, limit]);
  return { items, loadMore };
}
