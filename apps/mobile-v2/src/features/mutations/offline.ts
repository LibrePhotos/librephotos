/**
 * Which mutation/selection actions are available offline (doc 05). Offline
 * actions go through the outbox; online-only actions are rendered disabled with
 * a clear "needs connection" state when there's no network. Pure so the enable/
 * disable logic is unit-tested without a network stack.
 */
export type GridAction =
  | "favorite"
  | "hide"
  | "trash"
  | "addToAlbum"
  // online-only:
  | "download"
  | "shareLink"
  | "deletePermanent";

/**
 * Every action the photo viewer offers (doc 07 §4). Unlike the grid, the viewer
 * is where per-photo *editing* lives, so this set is split: the first group maps
 * onto an outbox kind and therefore works offline; the second group is a direct
 * api-client call with nothing the mirror could optimistically represent, and is
 * disabled — visibly, with a reason — while offline.
 */
export type ViewerAction =
  | "favorite"
  | "hide"
  | "trash"
  | "restore"
  | "rating"
  | "caption"
  | "addToAlbum"
  | "removeFromAlbum"
  | "renamePerson"
  // online-only:
  | "timestamp"
  | "makePublic";

/** Actions the outbox can carry while offline (doc 03 §6 / doc 05). */
const OFFLINE_CAPABLE_GRID: ReadonlySet<GridAction> = new Set([
  "favorite",
  "hide",
  "trash",
  "addToAlbum",
]);

export function isGridActionOfflineCapable(action: GridAction): boolean {
  return OFFLINE_CAPABLE_GRID.has(action);
}

/**
 * An action is *available* when it is offline-capable OR the device is online.
 * Online-only actions (download / share-link / delete-permanent) are disabled
 * while offline.
 */
export function isGridActionAvailable(action: GridAction, isOnline: boolean): boolean {
  return isOnline || isGridActionOfflineCapable(action);
}

/**
 * Viewer actions the outbox can carry. Deliberately mirrors `OUTBOX_SCHEMAS`
 * (src/mutations/types.ts): if there is no outbox kind for it, it cannot be
 * offline-capable, because there would be nothing to replay.
 */
const OFFLINE_CAPABLE_VIEWER: ReadonlySet<ViewerAction> = new Set([
  "favorite",
  "hide",
  "trash",
  "restore",
  "rating",
  "caption",
  "addToAlbum",
  "removeFromAlbum",
  "renamePerson",
]);

export function isViewerActionOfflineCapable(action: ViewerAction): boolean {
  return OFFLINE_CAPABLE_VIEWER.has(action);
}

/**
 * A viewer action is *available* when it is offline-capable OR we are online.
 *
 * Timestamp edit is the interesting exclusion: it is per-photo editing like the
 * caption, but `remote_photo.timestamp` drives the timeline's ordering and its
 * `bucket_day`/`bucket_month` grouping, so an optimistic local write would
 * silently reshuffle the offline timeline against a change the server may yet
 * reject. A disabled button with a reason is the smaller lie.
 */
export function isViewerActionAvailable(action: ViewerAction, isOnline: boolean): boolean {
  return isOnline || isViewerActionOfflineCapable(action);
}
