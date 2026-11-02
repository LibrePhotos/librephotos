import { useCallback, useState } from "react";
import { useReactiveQuery } from "@/db/provider";
import {
  NO_TIMELINE_FILTER,
  timelinePage,
  timelineRowKey,
  type TimelineFilter,
} from "@/db/queries/timeline";
import type { MergedTimelineRow } from "@/db/types";
import type { TimelineItem } from "@/components/TimelineList";

const PAGE = 120;

export function rowToItem(r: MergedTimelineRow): TimelineItem {
  return {
    key: timelineRowKey(r),
    photoId: r.remote_id,
    imageHash: r.image_hash,
    type: r.type,
    dominantColor: r.dominant_color,
    localUri: r.local_uri,
    processing: r.processing === 1,
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
const TIMELINE_TABLES = [
  "remote_photo",
  "local_asset",
  "local_album",
  "local_album_asset",
  // The camera-roll rows' "processing on the server" badge (#2740).
  "upload_queue",
] as const;

/**
 * `filter` narrows the timeline (the filter sheet). Its fields, not its
 * identity, are the query's dependencies, so a filter rebuilt on every render
 * does not re-run the query.
 */
export function useMirrorTimeline(filter: TimelineFilter = NO_TIMELINE_FILTER) {
  const [limit, setLimit] = useState(PAGE);
  const { media, favorites, hideScreenshots, hideDocuments } = filter;
  const items = useReactiveQuery(
    (db) =>
      timelinePage(db, {
        limit,
        filter: { media, favorites, hideScreenshots, hideDocuments },
      }).rows.map(rowToItem),
    [limit, media, favorites, hideScreenshots, hideDocuments],
    TIMELINE_TABLES
  );
  const loadMore = useCallback(() => {
    if (items.length >= limit) setLimit((n) => n + PAGE);
  }, [items.length, limit]);
  /** Grow the window to hold at least `count` rows (a scrubber jump), in whole pages. */
  const loadAtLeast = useCallback((count: number) => {
    setLimit((n) => (count > n ? Math.ceil(count / PAGE) * PAGE : n));
  }, []);
  return { items, loadMore, loadAtLeast };
}
