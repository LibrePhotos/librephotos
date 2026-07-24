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

export type ViewerAction =
  | "favorite"
  | "hide"
  | "trash"
  | "restore"
  | "rating"
  | "caption"
  | "addToAlbum";

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

/** Every viewer action listed is offline-capable (favorite/hide/trash/…/caption). */
export function isViewerActionAvailable(_action: ViewerAction, _isOnline: boolean): boolean {
  return true;
}
