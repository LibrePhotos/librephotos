import { useCallback, useState } from "react";
import type { QueryClient } from "@tanstack/react-query";
import { liveQueryKey, useReactiveQuery, type ReactiveQueryKey } from "@/db/provider";
import {
  NO_TIMELINE_FILTER,
  timelineBuckets,
  timelinePage,
  timelineRowKey,
  type AppDatabase,
  type MergedTimelineRow,
  type TimelineBucket,
  type TimelineFilter,
} from "@librephotos/local-db";
import type { TimelineItem } from "@/components/TimelineList";

export const TIMELINE_PAGE = 120;
const PAGE = TIMELINE_PAGE;

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
/** The tables the day buckets read (the page's, minus the upload badge). */
export const TIMELINE_BUCKET_TABLES = ["remote_photo", "local_asset", "local_album", "local_album_asset"] as const;

const NO_ITEMS: TimelineItem[] = [];
const NO_BUCKETS: TimelineBucket[] = [];

/** A filter by its fields, so one rebuilt on every render keeps its key. */
function filterKey(f: TimelineFilter): readonly unknown[] {
  return [f.media, f.favorites, f.hideScreenshots, f.hideDocuments];
}

export function timelinePageKey(limit: number, filter: TimelineFilter): ReactiveQueryKey {
  return ["timeline-page", limit, ...filterKey(filter)];
}

export function timelineBucketsKey(filter: TimelineFilter): ReactiveQueryKey {
  return ["timeline-buckets", ...filterKey(filter)];
}

async function readTimelinePage(db: AppDatabase, limit: number, filter: TimelineFilter): Promise<TimelineItem[]> {
  const page = await timelinePage(db, { limit, filter });
  return page.rows.map(rowToItem);
}

/** Section headers / scrubber buckets of the (filtered) timeline. */
export function useTimelineBuckets(filter: TimelineFilter): { buckets: TimelineBucket[]; loading: boolean } {
  const { media, favorites, hideScreenshots, hideDocuments } = filter;
  const { data, loading } = useReactiveQuery(
    timelineBucketsKey(filter),
    async (db) => await timelineBuckets(db, { media, favorites, hideScreenshots, hideDocuments }),
    NO_BUCKETS,
    { tables: TIMELINE_BUCKET_TABLES, keepPrevious: true }
  );
  return { buckets: data, loading };
}

/**
 * Read the timeline's first page and buckets into the live-query cache, so the
 * timeline's first frame after a cold start already has them (DatabaseGate
 * runs this while its spinner is up).
 */
export async function prefetchTimeline(queries: QueryClient, db: AppDatabase, filter: TimelineFilter): Promise<void> {
  await Promise.all([
    queries.prefetchQuery({
      queryKey: liveQueryKey(timelinePageKey(PAGE, filter)),
      queryFn: () => readTimelinePage(db, PAGE, filter),
      meta: { tables: TIMELINE_TABLES },
    }),
    queries.prefetchQuery({
      queryKey: liveQueryKey(timelineBucketsKey(filter)),
      queryFn: async () => await timelineBuckets(db, filter),
      meta: { tables: TIMELINE_BUCKET_TABLES },
    }),
  ]);
}

export function useMirrorTimeline(filter: TimelineFilter = NO_TIMELINE_FILTER) {
  const [limit, setLimit] = useState(PAGE);
  const { media, favorites, hideScreenshots, hideDocuments } = filter;
  // A growing window keeps the rows it has while the bigger page is read.
  const { data: items, loading } = useReactiveQuery(
    timelinePageKey(limit, filter),
    (db) => readTimelinePage(db, limit, { media, favorites, hideScreenshots, hideDocuments }),
    NO_ITEMS,
    { tables: TIMELINE_TABLES, keepPrevious: true }
  );
  const loadMore = useCallback(() => {
    if (items.length >= limit) setLimit((n) => n + PAGE);
  }, [items.length, limit]);
  /** Grow the window to hold at least `count` rows (a scrubber jump), in whole pages. */
  const loadAtLeast = useCallback((count: number) => {
    setLimit((n) => (count > n ? Math.ceil(count / PAGE) * PAGE : n));
  }, []);
  return { items, loading, loadMore, loadAtLeast };
}
