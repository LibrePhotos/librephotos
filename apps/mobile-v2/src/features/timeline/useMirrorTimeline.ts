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
/**
 * Every table `timelinePage` reads, across both of its shapes: the remote fast
 * path (`remote_photo` only) and the merged `UNION ALL` (adds the three local
 * media tables, including the `backup_selection` join). Declared so the query is
 * not re-run by unrelated churn — during a scan that is `job_queue`, `sync_log`
 * and `app_meta` on essentially every job.
 */
const TIMELINE_TABLES = ["remote_photo", "local_asset", "local_album", "local_album_asset"] as const;

export function useMirrorTimeline() {
  const [limit, setLimit] = useState(PAGE);
  const items = useReactiveQuery(
    (db) => timelinePage(db, { limit }).rows.map(rowToItem),
    [limit],
    TIMELINE_TABLES
  );
  const loadMore = useCallback(() => {
    if (items.length >= limit) setLimit((n) => n + PAGE);
  }, [items.length, limit]);
  return { items, loadMore };
}
