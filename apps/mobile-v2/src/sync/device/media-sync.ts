/**
 * Camera-roll → local_asset diff (doc 03 §4). Pure orchestration over a
 * {@link MediaProvider}: permission flow, album enumeration, a `createdAfter`
 * fast path per album, and a metadata-only full id-diff fallback when an album's
 * count no longer matches the DB (Immich's `checkAddition` → `fullDiff`
 * pattern). Deletions surface from the full diff + a final orphan sweep.
 *
 * No expo imports: the app wires the real expo-media-library provider in
 * sync/run; the Node tests drive a fake provider.
 */
import type { AppDatabase } from "@/db/types";
import type { SyncLogEntry } from "@/db/queries/sync-log";
import type { MediaAlbum, MediaAsset, MediaProvider } from "./types";
import {
  albumAssetIndex,
  albumMembershipCount,
  getAlbumWatermark,
  getLocalAlbum,
  linkAlbumAssets,
  setAlbumWatermark,
  setMediaAccess,
  sweepOrphanAssets,
  unlinkAlbumAssets,
  upsertLocalAlbum,
  upsertLocalAssets,
} from "./media-store";

/** Synthetic album id used for the iOS "limited" fallback (whole selection). */
export const LIMITED_ALBUM_ID = "__limited__";

const PAGE = 500;

export class DeviceSyncAbortedError extends Error {
  constructor() {
    super("device sync aborted");
    this.name = "DeviceSyncAbortedError";
  }
}

export type DeviceSyncOptions = {
  signal?: AbortSignal;
  now?: number;
  /** Page size for metadata fetches. */
  pageSize?: number;
  log?: (entry: SyncLogEntry) => void;
};

export type DeviceSyncResult = {
  access: "all" | "limited" | "none";
  albums: number;
  added: number;
  updated: number;
  removed: number;
  deleted: number;
};

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DeviceSyncAbortedError();
}

/** Fetch every asset for a query, paging to exhaustion. */
async function fetchAll(
  provider: MediaProvider,
  base: { albumId?: string; createdAfter?: number; ascending?: boolean },
  pageSize: number,
  signal?: AbortSignal
): Promise<MediaAsset[]> {
  const out: MediaAsset[] = [];
  let after: string | undefined;
  for (;;) {
    throwIfAborted(signal);
    const page = await provider.getAssets({ ...base, first: pageSize, after });
    out.push(...page.assets);
    if (!page.hasNextPage || page.assets.length === 0) break;
    after = page.endCursor;
  }
  return out;
}

/**
 * Reconcile one album. Fast path: pull only assets created after the stored
 * watermark and link them. If the album's provider count still disagrees with
 * our membership afterward, run the full id-diff (adds, removals, edits).
 */
async function syncAlbum(
  db: AppDatabase,
  provider: MediaProvider,
  album: MediaAlbum,
  opts: Required<Pick<DeviceSyncOptions, "now" | "pageSize">> & {
    signal?: AbortSignal;
    log?: (entry: SyncLogEntry) => void;
  },
  acc: DeviceSyncResult
): Promise<void> {
  const stored = getLocalAlbum(db, album.id);
  upsertLocalAlbum(db, {
    id: album.id,
    title: album.title,
    assetCount: album.assetCount,
    modifiedAt: opts.now,
  });

  const watermark = getAlbumWatermark(db, album.id);
  const isFirstSync = stored == null || watermark == null;

  // ---- fast path: additions since the watermark --------------------------
  const fastAssets = await fetchAll(
    provider,
    { albumId: album.id === LIMITED_ALBUM_ID ? undefined : album.id, createdAfter: isFirstSync ? undefined : watermark ?? undefined, ascending: true },
    opts.pageSize,
    opts.signal
  );
  if (fastAssets.length > 0) {
    upsertLocalAssets(db, fastAssets);
    linkAlbumAssets(db, album.id, fastAssets.map((a) => a.id));
    acc.added += fastAssets.length;
    const maxCreated = fastAssets.reduce((m, a) => Math.max(m, a.creationTime), watermark ?? 0);
    setAlbumWatermark(db, album.id, maxCreated, opts.now);
  } else if (isFirstSync) {
    setAlbumWatermark(db, album.id, 0, opts.now);
  }

  // ---- full diff fallback: only when counts still disagree ----------------
  const ourCount = albumMembershipCount(db, album.id);
  if (ourCount !== album.assetCount) {
    await fullDiff(db, provider, album, opts, acc);
  }
}

/**
 * Metadata-only sorted-merge of the album's full asset id set against the DB.
 * Adds missing, re-links, upserts modified (modificationTime change ⇒ hash
 * invalidation via upsertLocalAssets), and unlinks assets gone from the album.
 */
async function fullDiff(
  db: AppDatabase,
  provider: MediaProvider,
  album: MediaAlbum,
  opts: { now: number; pageSize: number; signal?: AbortSignal; log?: (entry: SyncLogEntry) => void },
  acc: DeviceSyncResult
): Promise<void> {
  const deviceAssets = await fetchAll(
    provider,
    { albumId: album.id === LIMITED_ALBUM_ID ? undefined : album.id, ascending: false },
    opts.pageSize,
    opts.signal
  );
  const stored = albumAssetIndex(db, album.id);

  const toUpsert: MediaAsset[] = [];
  const toLink: string[] = [];
  const seen = new Set<string>();
  for (const a of deviceAssets) {
    seen.add(a.id);
    const prevModified = stored.get(a.id);
    if (prevModified === undefined) {
      toUpsert.push(a);
      toLink.push(a.id);
      acc.added += 1;
    } else if (prevModified !== a.modificationTime) {
      toUpsert.push(a); // edit → re-hash
      acc.updated += 1;
    }
  }
  if (toUpsert.length > 0) upsertLocalAssets(db, toUpsert);
  if (toLink.length > 0) linkAlbumAssets(db, album.id, toLink);

  const removed = [...stored.keys()].filter((id) => !seen.has(id));
  if (removed.length > 0) {
    unlinkAlbumAssets(db, album.id, removed);
    acc.removed += removed.length;
  }
  opts.log?.({
    op: "device",
    level: "info",
    message: `fullDiff ${album.title}: +${toLink.length} ~${toUpsert.length - toLink.length} -${removed.length}`,
  });
}

/**
 * Run one device-media sync pass. Returns counts; a `none` access result is a
 * no-op (nothing to sync, no error). Idempotent + cancellable.
 */
export async function syncDeviceMedia(
  db: AppDatabase,
  provider: MediaProvider,
  opts: DeviceSyncOptions = {}
): Promise<DeviceSyncResult> {
  const now = opts.now ?? Date.now();
  const pageSize = opts.pageSize ?? PAGE;
  const acc: DeviceSyncResult = { access: "none", albums: 0, added: 0, updated: 0, removed: 0, deleted: 0 };

  let perm = await provider.getPermissions();
  if (!perm.granted && perm.canAskAgain) perm = await provider.requestPermissions();
  acc.access = perm.accessPrivileges;
  setMediaAccess(db, perm.accessPrivileges, now);
  if (!perm.granted || perm.accessPrivileges === "none") {
    opts.log?.({ op: "device", level: "warn", message: "media permission not granted" });
    return acc;
  }

  // iOS "limited" access hides album structure: sync the shown selection as one
  // synthetic album (doc 03 §4 — "sync what we're shown").
  let albums: MediaAlbum[];
  if (perm.accessPrivileges === "limited") {
    const head = await provider.getAssets({ first: 1, ascending: false });
    albums = [{ id: LIMITED_ALBUM_ID, title: "Selected", assetCount: head.totalCount }];
  } else {
    albums = await provider.getAlbums();
  }
  acc.albums = albums.length;

  for (const album of albums) {
    throwIfAborted(opts.signal);
    await syncAlbum(db, provider, album, { now, pageSize, signal: opts.signal, log: opts.log }, acc);
  }

  // Device-wide deletions: any asset now in no album at all.
  const deleted = sweepOrphanAssets(db);
  acc.deleted = deleted.length;

  opts.log?.({
    op: "device",
    level: "info",
    applied: acc.added + acc.updated,
    deleted: acc.deleted,
    message: `${acc.albums} album(s): +${acc.added} ~${acc.updated} -${acc.removed} del=${acc.deleted}`,
  });
  return acc;
}
