/**
 * Test doubles for the delta engine: an in-memory RemoteSyncSource that serves
 * keyset-paginated pages exactly like the backend (`api/views/sync.py`) — order
 * by (last_modified, id), cursor = last returned key, `total` only on the
 * cursorless seed request, tombstones only on cursored requests. Item builders
 * produce valid wire shapes for each entity.
 *
 * This is a helper, not a test file (no `.test.ts` suffix), so jest does not run
 * it directly.
 */
import { ApiError } from "@librephotos/api-client";
import type {
  SyncAutoAlbumItem,
  SyncCounts,
  SyncNamedAlbumItem,
  SyncPersonItem,
  SyncPhotoItem,
  SyncPlaceAlbumItem,
  SyncSharedUserItem,
  SyncUserAlbumItem,
} from "@librephotos/api-client";
import type { RemoteSyncSource, SyncPullParams } from "../remote/source";
import type { SyncEntity } from "@/db/queries/sync-state";

/* ---- cursor codec (opaque token; client never inspects it) ------------- */

export function encodeCursor(lastModified: number, id: string | number): string {
  return Buffer.from(`${lastModified}|${id}`).toString("base64");
}
function decodeCursor(token: string): { lm: number; id: string } {
  const [lm, id] = Buffer.from(token, "base64").toString("utf8").split("|");
  return { lm: Number(lm), id: id ?? "" };
}

type Keyed = { id: string | number; last_modified: number | null };

function cmp(a: Keyed, b: Keyed): number {
  const am = a.last_modified ?? 0;
  const bm = b.last_modified ?? 0;
  if (am !== bm) return am - bm;
  return String(a.id) > String(b.id) ? 1 : String(a.id) < String(b.id) ? -1 : 0;
}

export type PageOverrides = { tombstones?: string[] };

/** Serve one keyset page, mirroring the backend envelope contract. */
export function keysetPage<T extends Keyed>(
  items: T[],
  params: SyncPullParams,
  overrides: PageOverrides = {}
) {
  const sorted = [...items].sort(cmp);
  let start = 0;
  if (params.cursor) {
    const { lm, id } = decodeCursor(params.cursor);
    start = sorted.findIndex(
      (i) => (i.last_modified ?? 0) > lm || ((i.last_modified ?? 0) === lm && String(i.id) > id)
    );
    if (start === -1) start = sorted.length;
  }
  const pageSize = params.pageSize ?? 1000;
  const slice = sorted.slice(start, start + pageSize);
  const last = slice[slice.length - 1];
  const next_cursor = last ? encodeCursor(last.last_modified ?? 0, last.id) : null;
  return {
    v: 1 as const,
    items: slice,
    // Tombstones only surface on cursored (non-seed) pulls, like the backend.
    tombstones: params.cursor ? (overrides.tombstones ?? []) : [],
    next_cursor,
    ...(params.cursor ? {} : { total: items.length }),
    server_time: new Date(0).toISOString(),
  };
}

/* ---- item builders ------------------------------------------------------ */

export function photoItem(id: string, over: Partial<SyncPhotoItem> = {}): SyncPhotoItem {
  return {
    id,
    image_hash: `hash-${id}`,
    owner_id: 1,
    timestamp: 1_700_000_000_000,
    added_on: 1_700_000_000_000,
    last_modified: 1000,
    type: "image",
    video_length_ms: null,
    rating: 0,
    is_favorite: false,
    hidden: false,
    in_trashcan: false,
    removed: false,
    is_public: false,
    aspect_ratio: 1,
    latitude: null,
    longitude: null,
    search_location: null,
    dominant_color: null,
    ...over,
  };
}

export function personItem(id: number, over: Partial<SyncPersonItem> = {}): SyncPersonItem {
  return { id, name: `p${id}`, kind: "user", face_count: 0, cover_photo_hash: null, last_modified: 1000, ...over };
}

export function userAlbumItem(id: number, over: Partial<SyncUserAlbumItem> = {}): SyncUserAlbumItem {
  return {
    id,
    title: `album ${id}`,
    owner_id: 1,
    favorited: false,
    shared: 0,
    cover_hash: null,
    photo_count: 0,
    created_on: null,
    last_modified: 1000,
    photo_ids: [],
    ...over,
  };
}

export function autoAlbumItem(id: number, over: Partial<SyncAutoAlbumItem> = {}): SyncAutoAlbumItem {
  return {
    id,
    title: `event ${id}`,
    timestamp: null,
    favorited: false,
    photo_count: 0,
    cover_hash: null,
    last_modified: 1000,
    photo_ids: [],
    ...over,
  };
}

export function namedAlbumItem(id: number, over: Partial<SyncNamedAlbumItem> = {}): SyncNamedAlbumItem {
  return { id, title: `named ${id}`, photo_count: 0, cover_hashes: [], last_modified: 1000, ...over };
}

export function placeAlbumItem(id: number, over: Partial<SyncPlaceAlbumItem> = {}): SyncPlaceAlbumItem {
  return { id, title: `place ${id}`, photo_count: 0, cover_hashes: [], geolocation_level: 1, last_modified: 1000, ...over };
}

export function sharedUserItem(id: number, over: Partial<SyncSharedUserItem> = {}): SyncSharedUserItem {
  return { id, username: `u${id}`, first_name: null, last_name: null, avatar_url: null, last_modified: 1000, ...over };
}

/* ---- the fake source ---------------------------------------------------- */

type Store = {
  photo: SyncPhotoItem[];
  person: SyncPersonItem[];
  user_album: SyncUserAlbumItem[];
  auto_album: SyncAutoAlbumItem[];
  thing_album: SyncNamedAlbumItem[];
  place_album: SyncPlaceAlbumItem[];
  tag_album: SyncNamedAlbumItem[];
  sharing: SyncSharedUserItem[];
};

export type FakeSourceConfig = {
  /** Tombstones returned per entity on cursored pulls. */
  tombstones?: Partial<Record<SyncEntity, string[]>>;
  /** Entities that should throw a 410 on the FIRST fetch (then succeed). */
  expireOnce?: Partial<Record<SyncEntity, boolean>>;
  /** Override the counts() response (defaults to current store sizes). */
  counts?: Partial<SyncCounts>;
};

/** In-memory RemoteSyncSource that records fetch order + call counts. */
export class FakeSource implements RemoteSyncSource {
  readonly fetchOrder: SyncEntity[] = [];
  readonly calls: Record<string, number> = {};
  private expired: Partial<Record<SyncEntity, boolean>>;

  constructor(
    public store: Store,
    private config: FakeSourceConfig = {}
  ) {
    this.expired = { ...(config.expireOnce ?? {}) };
  }

  private serve<T extends Keyed>(entity: SyncEntity, items: T[], params: SyncPullParams) {
    this.fetchOrder.push(entity);
    this.calls[entity] = (this.calls[entity] ?? 0) + 1;
    if (this.expired[entity]) {
      this.expired[entity] = false; // only once
      throw new ApiError(410, "/sync", "cursor_expired", { error: "cursor_expired" });
    }
    return keysetPage(items, params, { tombstones: this.config.tombstones?.[entity] });
  }

  photos(p: SyncPullParams) {
    return Promise.resolve(this.serve("photo", this.store.photo, p) as never);
  }
  persons(p: SyncPullParams) {
    return Promise.resolve(this.serve("person", this.store.person, p) as never);
  }
  userAlbums(p: SyncPullParams) {
    return Promise.resolve(this.serve("user_album", this.store.user_album, p) as never);
  }
  autoAlbums(p: SyncPullParams) {
    return Promise.resolve(this.serve("auto_album", this.store.auto_album, p) as never);
  }
  thingAlbums(p: SyncPullParams) {
    return Promise.resolve(this.serve("thing_album", this.store.thing_album, p) as never);
  }
  placeAlbums(p: SyncPullParams) {
    return Promise.resolve(this.serve("place_album", this.store.place_album, p) as never);
  }
  tagAlbums(p: SyncPullParams) {
    return Promise.resolve(this.serve("tag_album", this.store.tag_album, p) as never);
  }
  sharing(p: SyncPullParams) {
    return Promise.resolve(this.serve("sharing", this.store.sharing, p) as never);
  }
  counts(): Promise<SyncCounts> {
    return Promise.resolve({
      photos: this.store.photo.length,
      persons: this.store.person.length,
      user_albums: this.store.user_album.length,
      auto_albums: this.store.auto_album.length,
      thing_albums: this.store.thing_album.length,
      place_albums: this.store.place_album.length,
      tags: this.store.tag_album.length,
      server_time: new Date(0).toISOString(),
      ...this.config.counts,
    });
  }
}

export function emptyStore(): Store {
  return {
    photo: [],
    person: [],
    user_album: [],
    auto_album: [],
    thing_album: [],
    place_album: [],
    tag_album: [],
    sharing: [],
  };
}
