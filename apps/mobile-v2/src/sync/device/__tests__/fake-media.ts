/**
 * In-memory fakes for the device-media seams, for the Node tests. FakeMedia
 * holds albums + their assets and answers getAssets queries (createdAfter,
 * paging, album scoping) the same way expo-media-library would, so the pure
 * media-sync + hasher can be driven with no native modules.
 */
import type {
  AssetHasher,
  AssetHashResult,
  AssetMaterializer,
  HashableAsset,
  MaterializedAsset,
  MediaAlbum,
  MediaAsset,
  MediaPage,
  MediaPermission,
  MediaProvider,
  MediaQuery,
} from "../types";

export function asset(id: string, overrides: Partial<MediaAsset> = {}): MediaAsset {
  return {
    id,
    filename: overrides.filename ?? `${id}.jpg`,
    uri: overrides.uri ?? `ph://${id}`,
    type: overrides.type ?? "image",
    width: overrides.width ?? 100,
    height: overrides.height ?? 100,
    creationTime: overrides.creationTime ?? 1_000,
    modificationTime: overrides.modificationTime ?? overrides.creationTime ?? 1_000,
    duration: overrides.duration ?? 0,
  };
}

export class FakeMedia implements MediaProvider {
  permission: MediaPermission = { granted: true, canAskAgain: true, accessPrivileges: "all" };
  /** albumId → ordered assets. */
  albums = new Map<string, { title: string; assets: MediaAsset[]; isSmart?: boolean }>();
  requestCount = 0;
  listeners: (() => void)[] = [];
  /** Query log for asserting fast-path vs full-diff behaviour. */
  queries: MediaQuery[] = [];

  setAlbum(id: string, title: string, assets: MediaAsset[], opts: { isSmart?: boolean } = {}): void {
    this.albums.set(id, { title, assets, isSmart: opts.isSmart });
  }

  async getPermissions(): Promise<MediaPermission> {
    return this.permission;
  }
  async requestPermissions(): Promise<MediaPermission> {
    this.requestCount += 1;
    return this.permission;
  }
  async getAlbums(): Promise<MediaAlbum[]> {
    return [...this.albums.entries()].map(([id, a]) => ({
      id,
      title: a.title,
      assetCount: a.assets.length,
      isSmart: a.isSmart,
    }));
  }
  async getAssets(query: MediaQuery): Promise<MediaPage> {
    this.queries.push(query);
    // Whole library (limited fallback) = union of all albums (deduped by id).
    let pool: MediaAsset[];
    if (query.albumId == null) {
      const seen = new Set<string>();
      pool = [];
      for (const a of this.albums.values()) {
        for (const x of a.assets) {
          if (!seen.has(x.id)) {
            seen.add(x.id);
            pool.push(x);
          }
        }
      }
    } else {
      pool = this.albums.get(query.albumId)?.assets ?? [];
    }
    let filtered = pool;
    if (query.createdAfter != null) {
      const after = typeof query.createdAfter === "number" ? query.createdAfter : 0;
      filtered = filtered.filter((a) => a.creationTime > after);
    }
    filtered = [...filtered].sort((a, b) =>
      query.ascending ? a.creationTime - b.creationTime : b.creationTime - a.creationTime
    );
    const start = query.after ? Number(query.after) : 0;
    const slice = filtered.slice(start, start + query.first);
    const end = start + slice.length;
    return {
      assets: slice,
      endCursor: String(end),
      hasNextPage: end < filtered.length,
      totalCount: filtered.length,
    };
  }
  addChangeListener(listener: () => void) {
    this.listeners.push(listener);
    return { remove: () => (this.listeners = this.listeners.filter((l) => l !== listener)) };
  }
  emitChange(): void {
    for (const l of this.listeners) l();
  }
}

/**
 * Deterministic hasher: md5 = `md5:<id>` unless overridden; records order.
 *
 * `remote` marks assets whose bytes live in iCloud — the fake refuses to hash
 * them just as the real one does, and `materialized` records every asset that
 * had to be fetched, so a test can assert the default path never downloads.
 */
export class FakeHasher implements AssetHasher, AssetMaterializer {
  order: string[] = [];
  fail = new Set<string>();
  remote = new Set<string>();
  map = new Map<string, string>();
  materialized: string[] = [];

  async hash(a: HashableAsset): Promise<AssetHashResult> {
    this.order.push(a.id);
    if (this.fail.has(a.id)) return { status: "unavailable" };
    if (this.remote.has(a.id)) return { status: "remote" };
    return { status: "hashed", md5: this.map.get(a.id) ?? `md5:${a.id}` };
  }

  async materialize(a: HashableAsset): Promise<MaterializedAsset | null> {
    this.materialized.push(a.id);
    if (this.fail.has(a.id)) return null;
    return { uri: `file://${a.id}`, md5: this.map.get(a.id) ?? `md5:${a.id}` };
  }
}
