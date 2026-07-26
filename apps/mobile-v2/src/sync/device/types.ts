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

/** Abstraction over the native md5 hasher used by the pure hash pipeline. */
export interface AssetHasher {
  /**
   * Return the raw md5 hex of the asset's file bytes (NO user id suffix), or
   * null if the file can't be read. The implementation resolves `ph://` assets
   * to a readable local uri first when needed.
   */
  md5(asset: { id: string; uri: string; type: LocalMediaType }): Promise<string | null>;
}
