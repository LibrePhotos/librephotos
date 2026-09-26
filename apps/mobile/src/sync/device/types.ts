/**
 * Injectable seams for the device-media layer (doc 03 §4). The pure sync/hash
 * logic is written against these interfaces so it is unit-tested under Node with
 * fakes — no expo-media-library, no expo-file-system, no React. The real
 * implementations (backed by expo-media-library / expo-file-system) live in
 * ./expo-media-provider and ./expo-asset-hasher and are imported ONLY from the
 * app-side wiring (sync/run), never from the pure modules or the Node tests.
 */

/** Normalized media type — only image/video matter for the mirror. */
export type LocalMediaType = "image" | "video";

/** iOS "limited" access is degraded gracefully: we sync only what we're shown. */
export type MediaAccess = "all" | "limited" | "none";

export type MediaPermission = {
  granted: boolean;
  canAskAgain: boolean;
  accessPrivileges: MediaAccess;
};

/** An album as reported by the media library (id + estimated asset count). */
export type MediaAlbum = {
  id: string;
  title: string;
  assetCount: number;
  /**
   * True for an OS-generated smart album (iOS: Recents, Favorites, Screenshots,
   * Selfies, …). These overlap each other and the camera roll almost entirely,
   * so the device sync skips them — enumerating them turned a first sync into
   * O(albums × assets) and froze the app. Undefined on platforms that do not
   * report album kinds.
   */
  isSmart?: boolean;
};

/** A single camera-roll asset (metadata only; bytes are fetched lazily). */
export type MediaAsset = {
  id: string;
  filename: string;
  uri: string;
  type: LocalMediaType;
  width: number;
  height: number;
  /** ms epoch. */
  creationTime: number;
  /** ms epoch. */
  modificationTime: number;
  /** seconds (0 for images). */
  duration: number;
};

export type MediaQuery = {
  /** Album to scope to. Omit for the whole library (iOS limited fallback). */
  albumId?: string;
  first: number;
  /** Opaque cursor from a previous page (PagedInfo.endCursor). */
  after?: string;
  /** Only assets created after this ms-epoch (fast-path watermark). */
  createdAfter?: number;
  /** Ascending by creation time when true (fast path); newest-first otherwise. */
  ascending?: boolean;
};

export type MediaPage = {
  assets: MediaAsset[];
  endCursor: string;
  hasNextPage: boolean;
  totalCount: number;
};

/** Abstraction over expo-media-library used by the pure device sync. */
export interface MediaProvider {
  getPermissions(): Promise<MediaPermission>;
  requestPermissions(): Promise<MediaPermission>;
  getAlbums(): Promise<MediaAlbum[]>;
  getAssets(query: MediaQuery): Promise<MediaPage>;
  /** Fire-on-change subscription; returns an unsubscribe handle. */
  addChangeListener(listener: () => void): { remove: () => void };
}

/** The asset identity the hashing/materialising seams work on. */
export type HashableAsset = { id: string; uri: string; type: LocalMediaType };

/**
 * What one hash attempt learned. Three outcomes, not two, because "the bytes
 * are not on this device" is a *state*, not a failure:
 *
 * - `hashed`      — raw md5 hex of the file bytes (NO user-id suffix).
 * - `remote`      — iOS only: the original lives in iCloud (the device is on
 *                   "Optimise iPhone Storage"). Reading it would download a
 *                   multi-megabyte original, so the pass records the state and
 *                   moves on; the upload path fetches it later, once, if the
 *                   user actually asked for this album to be backed up.
 * - `unavailable` — permanently unreadable (deleted, corrupt, unsupported).
 */
export type AssetHashResult =
  | { status: "hashed"; md5: string }
  | { status: "remote" }
  | { status: "unavailable" };

/** Abstraction over the native md5 hasher used by the pure hash pipeline. */
export interface AssetHasher {
  /**
   * Hash the asset's bytes **without ever touching the network**. An asset that
   * would have to be downloaded first answers `{ status: "remote" }` instead of
   * quietly stalling the pipeline for seconds per photo.
   */
  hash(asset: HashableAsset): Promise<AssetHashResult>;
}

/** The bytes of an asset, on disk and already checksummed. */
export type MaterializedAsset = {
  /** A readable `file://` uri for the bytes. */
  uri: string;
  /** Raw md5 hex of those exact bytes (NO user-id suffix). */
  md5: string;
};

/**
 * The one place allowed to pull an original down from iCloud — and it hands
 * back the md5 of what it fetched, so the bytes are paid for **once**: the
 * upload path hashes them on their way out instead of downloading to hash and
 * downloading again to upload.
 */
export interface AssetMaterializer {
  materialize(asset: HashableAsset): Promise<MaterializedAsset | null>;
}
