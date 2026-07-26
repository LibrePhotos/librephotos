/**
 * Camera-roll → local_asset diff (doc 03 §4). Pure orchestration over a
 * {@link MediaProvider}: permission flow, album enumeration, a `createdAfter`
 * fast path per album, and a metadata-only full id-diff fallback when an album's
 * count no longer matches the DB (Immich's `checkAddition` → `fullDiff`
 * pattern). Deletions surface from the full diff + a final orphan sweep.
 *
 * No expo imports: the app wires the real expo-media-library provider in
 * sync/run; the Node tests drive a fake provider.
 *
 * ## Why this module is written the way it is (device-run regression)
 *
 * The first physical-device run froze the whole app the moment photo-library
 * permission was granted. Three compounding causes, all fixed here — do not
 * undo any of them:
 *
 *  1. **Smart albums multiplied the work.** iOS reports ~20 overlapping smart
 *     albums (Recents, Favorites, Screenshots, Selfies, Live Photos, …) that
 *     mostly contain the *same* assets, so enumeration was O(albums × assets)
 *     with near-total duplication. We now enumerate the whole library **once**
 *     as a synthetic album ({@link LIBRARY_ALBUM_ID}) and skip smart albums —
 *     their assets are already covered — keeping only user-created albums for
 *     per-album backup selection.
 *  2. **Nothing yielded.** The page loop and the SQLite writes ran to
 *     exhaustion inside one JS task, starving the UI thread. Every page now
 *     streams: fetch → write → `await yield()`. The default yield is a
 *     macrotask, so React can commit and the live queries can repaint — which
 *     is also what makes the first screenful of photos appear long before the
 *     library finishes.
 *  3. **Everything was buffered in memory.** `fetchAll` accumulated the entire
 *     library into one array and wrote it in a single giant transaction. Pages
 *     are now written as they arrive, so rows land in the mirror incrementally.
 *
 * Two further guards: assets already written this run are never re-written
 * (`seen`), and `maxAssetsPerRun` bounds the initial pass — the fast path runs
 * `ascending` and stores a watermark, so a truncated run simply resumes where
 * it stopped on the next sync.
 */
import type { AppDatabase } from "@/db/types";
import type { SyncLogEntry } from "@/db/queries/sync-log";
import type { MediaAlbum, MediaAsset, MediaProvider } from "./types";
import {
  albumAssetIndex,
  albumMembershipCount,
  existingAssetIds,
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
/**
 * Synthetic album id for "everything in the camera roll". Enumerated once per
 * run instead of walking every overlapping iOS smart album; it is also what the
 * user selects on the Backup screen to back up their whole library.
 */
export const LIBRARY_ALBUM_ID = "__library__";

/** True for the two synthetic albums, which query the library unscoped. */
function isSyntheticAlbum(id: string): boolean {
  return id === LIMITED_ALBUM_ID || id === LIBRARY_ALBUM_ID;
}

/**
 * Assets per provider page. Small enough that one page's native fetch + SQLite
 * write stays well inside a frame budget, large enough not to spam the bridge.
 */
const PAGE = 200;

/** Default cap on assets enumerated in a single run (the rest resumes next run). */
const MAX_ASSETS_PER_RUN = 20_000;

/** SQLite tolerates ~999 bound variables; stay comfortably under it. */
const ID_CHUNK = 400;

const defaultYield = () => new Promise<void>((r) => setTimeout(r, 0));

export class DeviceSyncAbortedError extends Error {
  constructor() {
    super("device sync aborted");
    this.name = "DeviceSyncAbortedError";
  }
}

/** Coarse progress for the UI while a big library is being enumerated. */
export type DeviceSyncProgress = {
  /** Album title currently being scanned. */
  album: string;
  albumIndex: number;
  albums: number;
  /** Assets enumerated so far this run. */
  scanned: number;
  /** Best-known total for the run (sum of album counts); 0 when unknown. */
  total: number;
};

export type DeviceSyncOptions = {
  signal?: AbortSignal;
  now?: number;
  /** Page size for metadata fetches. */
  pageSize?: number;
  /** Hard cap on assets enumerated this run; the remainder resumes next run. */
  maxAssetsPerRun?: number;
  /** Title stored for the synthetic whole-library album. */
  libraryTitle?: string;
  log?: (entry: SyncLogEntry) => void;
  onProgress?: (progress: DeviceSyncProgress) => void;
  /** Yield hook between pages (defaults to a macrotask yield). */
  yield?: () => Promise<void>;
};

export type DeviceSyncResult = {
  access: "all" | "limited" | "none";
  albums: number;
  /** Distinct assets newly inserted into the mirror. */
  added: number;
  /** Distinct assets whose bytes changed (hash invalidated). */
  updated: number;
  /** Distinct assets unlinked from at least one album. */
  removed: number;
  /** Assets deleted from the device (orphaned across every album). */
  deleted: number;
  /** Asset rows written (＜ scanned when albums overlap — the dedupe metric). */
  upserted: number;
  /** Asset records read from the provider this run. */
  scanned: number;
  /** False when `maxAssetsPerRun` cut the run short; it resumes next sync. */
  complete: boolean;
};

/** Mutable per-run state threaded through the album walk. */
type RunContext = {
  db: AppDatabase;
  provider: MediaProvider;
  now: number;
  pageSize: number;
  budget: number;
  signal?: AbortSignal;
  log?: (entry: SyncLogEntry) => void;
  onProgress?: (progress: DeviceSyncProgress) => void;
  yield: () => Promise<void>;
  /** Asset ids already written this run — the cross-album dedupe. */
  seen: Set<string>;
  addedIds: Set<string>;
  updatedIds: Set<string>;
  removedIds: Set<string>;
  scanned: number;
  upserted: number;
  truncated: boolean;
  /** Progress bookkeeping. */
  album: string;
  albumIndex: number;
  albums: number;
  total: number;
};

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DeviceSyncAbortedError();
}

/**
 * Page through a query, handing each page to `onPage` and yielding to the event
 * loop in between so the UI thread keeps running. Stops early (and marks the run
 * truncated) once the per-run asset budget is spent.
 */
async function streamAssets(
  ctx: RunContext,
  base: { albumId?: string; createdAfter?: number; ascending?: boolean },
  onPage: (assets: MediaAsset[]) => void
): Promise<void> {
  let after: string | undefined;
  for (;;) {
    throwIfAborted(ctx.signal);
    const page = await ctx.provider.getAssets({ ...base, first: ctx.pageSize, after });
    if (page.assets.length > 0) {
      onPage(page.assets);
      ctx.scanned += page.assets.length;
      ctx.onProgress?.({
        album: ctx.album,
        albumIndex: ctx.albumIndex,
        albums: ctx.albums,
        scanned: ctx.scanned,
        total: ctx.total,
      });
    }
    // Hand the thread back before touching the provider again. This is the
    // single most important line in the module: without it a large library
    // locks the UI until enumeration finishes.
    await ctx.yield();
    if (!page.hasNextPage || page.assets.length === 0) return;
    if (ctx.scanned >= ctx.budget) {
      ctx.truncated = true;
      return;
    }
    after = page.endCursor;
  }
}

/**
 * Write one page: upsert the assets we have not already written this run, then
 * link the requested ids to the album. Returns nothing — counters live on `ctx`.
 */
function writeAssets(ctx: RunContext, albumId: string, assets: MediaAsset[], linkIds: string[]): void {
  const fresh = assets.filter((a) => !ctx.seen.has(a.id));
  if (fresh.length > 0) {
    // "New to the mirror" has to be decided before the upsert, so the reported
    // `added` count means inserts rather than inserts-plus-updates.
    const known = existingAssetIds(
      ctx.db,
      fresh.map((a) => a.id),
      ID_CHUNK
    );
    for (const a of fresh) {
      ctx.seen.add(a.id);
      if (!known.has(a.id)) ctx.addedIds.add(a.id);
    }
    upsertLocalAssets(ctx.db, fresh);
    ctx.upserted += fresh.length;
  }
  if (linkIds.length > 0) linkAlbumAssets(ctx.db, albumId, linkIds);
}

/**
 * Reconcile one album. Fast path: pull only assets created after the stored
 * watermark and link them. If the album's provider count still disagrees with
 * our membership afterward, run the full id-diff (adds, removals, edits).
 */
async function syncAlbum(ctx: RunContext, album: MediaAlbum): Promise<void> {
  const stored = getLocalAlbum(ctx.db, album.id);
  upsertLocalAlbum(ctx.db, {
    id: album.id,
    title: album.title,
    assetCount: album.assetCount,
    modifiedAt: ctx.now,
  });

  const watermark = getAlbumWatermark(ctx.db, album.id);
  const isFirstSync = stored == null || watermark == null;
  const albumId = isSyntheticAlbum(album.id) ? undefined : album.id;

  // ---- fast path: additions since the watermark --------------------------
  // Ascending on purpose: the watermark then advances monotonically, so a run
  // cut short by the budget resumes exactly where it stopped.
  let maxCreated = watermark ?? 0;
  let sawAny = false;
  await streamAssets(
    ctx,
    { albumId, createdAfter: isFirstSync ? undefined : (watermark ?? undefined), ascending: true },
    (assets) => {
      sawAny = true;
      writeAssets(
        ctx,
        album.id,
        assets,
        assets.map((a) => a.id)
      );
      for (const a of assets) maxCreated = Math.max(maxCreated, a.creationTime);
    }
  );
  if (sawAny) setAlbumWatermark(ctx.db, album.id, maxCreated, ctx.now);
  else if (isFirstSync) setAlbumWatermark(ctx.db, album.id, 0, ctx.now);

  // A truncated album is *expected* to disagree with the provider count — the
  // rest of it simply has not been read yet. Running the full diff here would
  // re-scan the album from scratch and defeat the budget.
  if (ctx.truncated) return;

  // ---- full diff fallback: only when counts still disagree ----------------
  const ourCount = albumMembershipCount(ctx.db, album.id);
  if (ourCount !== album.assetCount) await fullDiff(ctx, album, albumId);
}

/**
 * Metadata-only sorted-merge of the album's full asset id set against the DB.
 * Adds missing, re-links, upserts modified (modificationTime change ⇒ hash
 * invalidation via upsertLocalAssets), and unlinks assets gone from the album.
 * Streams page by page like the fast path; only the id set is held in memory.
 */
async function fullDiff(ctx: RunContext, album: MediaAlbum, albumId: string | undefined): Promise<void> {
  const stored = albumAssetIndex(ctx.db, album.id);
  const present = new Set<string>();
  let addedLinks = 0;
  let changed = 0;

  await streamAssets(ctx, { albumId, ascending: false }, (assets) => {
    const toWrite: MediaAsset[] = [];
    const toLink: string[] = [];
    for (const a of assets) {
      present.add(a.id);
      const prevModified = stored.get(a.id);
      if (prevModified === undefined) {
        toWrite.push(a);
        toLink.push(a.id);
        addedLinks += 1;
      } else if (prevModified !== a.modificationTime) {
        toWrite.push(a); // edit → re-hash
        ctx.updatedIds.add(a.id);
        changed += 1;
      }
    }
    writeAssets(ctx, album.id, toWrite, toLink);
  });

  // A truncated full diff has not seen the whole album, so "missing" ids are
  // simply unread — unlinking them would delete live photos from the mirror.
  if (ctx.truncated) return;

  const removed = [...stored.keys()].filter((id) => !present.has(id));
  if (removed.length > 0) {
    unlinkAlbumAssets(ctx.db, album.id, removed);
    for (const id of removed) ctx.removedIds.add(id);
  }
  ctx.log?.({
    op: "device",
    level: "info",
    message: `fullDiff ${album.title}: +${addedLinks} ~${changed} -${removed.length}`,
  });
}

/**
 * Build the album list to reconcile. Under full access that is the synthetic
 * whole-library album plus the user's own albums; iOS smart albums are dropped
 * because they duplicate the library pass. Under iOS "limited" access the album
 * structure is hidden, so we sync the shown selection as one synthetic album
 * (doc 03 §4 — "sync what we're shown").
 */
async function resolveAlbums(
  provider: MediaProvider,
  access: "all" | "limited",
  libraryTitle: string
): Promise<MediaAlbum[]> {
  const head = await provider.getAssets({ first: 1, ascending: false });
  if (access === "limited") {
    return [{ id: LIMITED_ALBUM_ID, title: "Selected", assetCount: head.totalCount }];
  }
  const library: MediaAlbum = {
    id: LIBRARY_ALBUM_ID,
    title: libraryTitle,
    assetCount: head.totalCount,
  };
  const userAlbums = (await provider.getAlbums()).filter(
    (a) => a.isSmart !== true && !isSyntheticAlbum(a.id)
  );
  return [library, ...userAlbums];
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
  const acc: DeviceSyncResult = {
    access: "none",
    albums: 0,
    added: 0,
    updated: 0,
    removed: 0,
    deleted: 0,
    upserted: 0,
    scanned: 0,
    complete: true,
  };

  let perm = await provider.getPermissions();
  if (!perm.granted && perm.canAskAgain) perm = await provider.requestPermissions();
  acc.access = perm.accessPrivileges;
  setMediaAccess(db, perm.accessPrivileges, now);
  if (!perm.granted || perm.accessPrivileges === "none") {
    opts.log?.({ op: "device", level: "warn", message: "media permission not granted" });
    return acc;
  }

  const albums = await resolveAlbums(provider, perm.accessPrivileges, opts.libraryTitle ?? "All Photos");
  acc.albums = albums.length;

  const ctx: RunContext = {
    db,
    provider,
    now,
    pageSize: opts.pageSize ?? PAGE,
    budget: opts.maxAssetsPerRun ?? MAX_ASSETS_PER_RUN,
    signal: opts.signal,
    log: opts.log,
    onProgress: opts.onProgress,
    yield: opts.yield ?? defaultYield,
    seen: new Set(),
    addedIds: new Set(),
    updatedIds: new Set(),
    removedIds: new Set(),
    scanned: 0,
    upserted: 0,
    truncated: false,
    album: "",
    albumIndex: 0,
    albums: albums.length,
    total: albums.reduce((sum, a) => sum + (a.assetCount || 0), 0),
  };

  for (const [index, album] of albums.entries()) {
    throwIfAborted(opts.signal);
    if (ctx.truncated) break;
    ctx.album = album.title;
    ctx.albumIndex = index;
    await syncAlbum(ctx, album);
  }

  acc.added = ctx.addedIds.size;
  acc.updated = ctx.updatedIds.size;
  acc.removed = ctx.removedIds.size;
  acc.upserted = ctx.upserted;
  acc.scanned = ctx.scanned;
  acc.complete = !ctx.truncated;

  // Device-wide deletions: any asset now in no album at all. Only safe once the
  // whole library has actually been walked — after a truncated run the unread
  // assets are not orphans, they are simply unread.
  if (!ctx.truncated) {
    acc.deleted = sweepOrphanAssets(db).length;
  }

  opts.log?.({
    op: "device",
    level: "info",
    applied: acc.added + acc.updated,
    deleted: acc.deleted,
    message:
      `${acc.albums} album(s): scanned=${acc.scanned} wrote=${acc.upserted} ` +
      `+${acc.added} ~${acc.updated} -${acc.removed} del=${acc.deleted}` +
      (acc.complete ? "" : " (partial — resumes next sync)"),
  });
  return acc;
}
