import { sql } from "drizzle-orm";
import { useQuery } from "@tanstack/react-query";
import { squareThumbnailUrl } from "@librephotos/api-client";
import type { AppDatabase } from "@librephotos/local-db";
import { liveQueryKey, useDb, useLiveQueryClient } from "@/db/provider";

const MAX_BATCH = 200;

type Pending = Map<string, ((path: string | null) => void)[]>;

const batches = new WeakMap<AppDatabase, Pending>();

async function flush(db: AppDatabase, pending: Pending): Promise<void> {
  const ids = [...pending.keys()];
  const found = new Map<string, string>();
  try {
    for (let i = 0; i < ids.length; i += MAX_BATCH) {
      const chunk = ids.slice(i, i + MAX_BATCH);
      const rows = await db.all<{ photo_id: string; file_path: string }>(
        sql`SELECT photo_id, file_path FROM thumb_cache WHERE photo_id IN (${sql.join(
          chunk.map((id) => sql`${id}`),
          sql`, `
        )})`
      );
      for (const row of rows) found.set(row.photo_id, row.file_path);
    }
  } finally {
    for (const [id, resolvers] of pending) for (const resolve of resolvers) resolve(found.get(id) ?? null);
  }
}

export function cachedThumbPath(db: AppDatabase, photoId: string): Promise<string | null> {
  return new Promise((resolve) => {
    let pending = batches.get(db);
    if (!pending) {
      const fresh: Pending = new Map();
      pending = fresh;
      batches.set(db, fresh);
      queueMicrotask(() => {
        batches.delete(db);
        void flush(db, fresh);
      });
    }
    const waiting = pending.get(photoId);
    if (waiting) waiting.push(resolve);
    else pending.set(photoId, [resolve]);
  });
}

export type ThumbItem = { photoId: string | null; imageHash: string | null; localUri?: string | null };

export function useThumbSource(item: ThumbItem, serverAddress: string): string | null | undefined {
  const db = useDb();
  const queries = useLiveQueryClient();
  const photoId = item.localUri ? null : item.photoId;
  const cached = useQuery(
    {
      queryKey: liveQueryKey(["thumb-path", photoId ?? ""]),
      queryFn: () => (photoId ? cachedThumbPath(db, photoId) : Promise.resolve(null)),
      meta: { tables: ["thumb_cache"] },
      enabled: photoId != null,
    },
    queries
  );
  if (item.localUri) return item.localUri;
  if (photoId != null) {
    if (cached.isPending) return undefined;
    if (cached.data) return cached.data;
  }
  return item.imageHash ? squareThumbnailUrl(serverAddress, item.imageHash) : null;
}
