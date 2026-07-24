/**
 * Full remote seed (Phase 1 groundwork). Populates the SQLite mirror from the
 * EXISTING server endpoints the frontend already uses (date albums / photo lists
 * / album lists / people) via @librephotos/api-client. Delta sync arrives in
 * Phase 2; pull-to-refresh today simply re-runs this seed (idempotent upserts).
 *
 * Design:
 *  - The data source is injected (`SeedSource`) so the orchestration is unit-
 *    tested under Node with a fake source (no network, no fetch).
 *  - Progress is persisted per entity in sync_state (resumable + determinate):
 *    the photo pass records completed date-bucket ids in cursor_id so a resumed
 *    seed skips buckets it already ingested.
 *  - is_favorite is materialized from rating >= favorite_min_rating and buckets
 *    are precomputed, both inside the writers.
 */
import { sql } from "drizzle-orm";
import type {
  ApiClient,
  AutoAlbum,
  AutoAlbumInfo,
  DateAlbumFilter,
  IncompleteDatePhotosGroup,
  PersonList,
  PigPhoto,
  PlaceAlbumInfo,
  AlbumInfo,
  TagListResponse,
  UserAlbum,
  UserAlbumInfo,
} from "@librephotos/api-client";
import * as apiEndpoints from "@librephotos/api-client";
import type { AppDatabase } from "@/db/types";
import { parseServerTimestamp } from "@/db/time";
import {
  pigPhotoToRemoteRow,
  upsertAutoAlbums,
  upsertPersons,
  upsertPlaceAlbums,
  upsertRemotePhotos,
  upsertTagAlbums,
  upsertThingAlbums,
  upsertUserAlbums,
  type MapOptions,
  type RemotePhotoInput,
} from "@/db/writers";
import { upsertSyncState, type SyncEntity } from "@/db/queries/sync-state";

/** The data the seeder pulls, abstracted for injection/testing. */
export interface SeedSource {
  dateAlbumsList(filter: DateAlbumFilter): Promise<IncompleteDatePhotosGroup[]>;
  dateAlbum(id: string, page: number, filter: DateAlbumFilter): Promise<IncompleteDatePhotosGroup>;
  photosWithoutTimestamp(page: number): Promise<{ results: PigPhoto[]; next?: string | null }>;
  people(): Promise<PersonList>;
  userAlbumsList(): Promise<UserAlbumInfo[]>;
  userAlbum(id: number): Promise<UserAlbum>;
  autoAlbumsList(): Promise<AutoAlbumInfo[]>;
  autoAlbum(id: number): Promise<AutoAlbum>;
  thingAlbumsList(): Promise<AlbumInfo[]>;
  placeAlbumsList(): Promise<PlaceAlbumInfo[]>;
  tagAlbumsList(): Promise<TagListResponse["results"]>;
}

/** Build a SeedSource backed by the real api-client endpoints. */
export function createApiSeedSource(client: ApiClient): SeedSource {
  return {
    dateAlbumsList: (filter) => apiEndpoints.endpoints.fetchDateAlbumsList(client, filter),
    dateAlbum: (id, page, filter) => apiEndpoints.endpoints.fetchDateAlbum(client, id, page, filter),
    photosWithoutTimestamp: (page) => apiEndpoints.endpoints.fetchPhotosWithoutTimestamp(client, page),
    people: () => apiEndpoints.endpoints.fetchPeopleAlbums(client),
    userAlbumsList: () => apiEndpoints.endpoints.fetchUserAlbumsList(client),
    userAlbum: (id) => apiEndpoints.endpoints.fetchUserAlbum(client, id),
    autoAlbumsList: () => apiEndpoints.endpoints.fetchAutoAlbumsList(client),
    autoAlbum: (id) => apiEndpoints.endpoints.fetchAutoAlbum(client, id),
    thingAlbumsList: () => apiEndpoints.endpoints.fetchThingAlbumsList(client),
    placeAlbumsList: () => apiEndpoints.endpoints.fetchPlaceAlbumsList(client),
    tagAlbumsList: () => apiEndpoints.endpoints.fetchTagAlbumsList(client),
  };
}

export type SeedProgress = {
  entity: SyncEntity | "overall";
  current: number;
  total: number;
};

export type SeedOptions = {
  ownerId: number;
  favoriteMinRating: number;
  now?: number;
  /** Cap on pages fetched per date bucket (defensive against a runaway server). */
  maxPagesPerBucket?: number;
  onProgress?: (p: SeedProgress) => void;
};

type PhotoPass = {
  name: string;
  filter: DateAlbumFilter;
  flags: Pick<MapOptions, "hidden" | "inTrashcan" | "isPublic">;
};

// The passes that together populate remote_photo with correct flags. Each pass
// upserts by id, so a photo appearing in several passes converges on the union
// of its flags (e.g. a hidden favorite).
const PHOTO_PASSES: PhotoPass[] = [
  { name: "timeline", filter: {}, flags: {} },
  { name: "hidden", filter: { hidden: true }, flags: { hidden: true } },
  { name: "trash", filter: { in_trashcan: true }, flags: { inTrashcan: true } },
];

function mapOpts(base: SeedOptions, flags: PhotoPass["flags"], now: number): MapOptions {
  return {
    ownerId: base.ownerId,
    favoriteMinRating: base.favoriteMinRating,
    now,
    ...flags,
  };
}

/** Collect every item of one date bucket, following pagination defensively. */
async function collectBucket(
  source: SeedSource,
  bucket: IncompleteDatePhotosGroup,
  filter: DateAlbumFilter,
  maxPages: number
): Promise<PigPhoto[]> {
  const items: PigPhoto[] = [];
  for (let page = 1; page <= maxPages; page++) {
    const group = await source.dateAlbum(bucket.id, page, filter);
    const pageItems = group.items ?? [];
    items.push(...pageItems);
    if (pageItems.length === 0 || items.length >= bucket.numberOfItems) break;
  }
  return items;
}

/** Seed remote_photo across all passes. Resumable via completed-bucket ids. */
export async function seedPhotos(
  db: AppDatabase,
  source: SeedSource,
  opts: SeedOptions
): Promise<number> {
  const now = opts.now ?? Date.now();
  const maxPages = opts.maxPagesPerBucket ?? 50;
  let written = 0;

  // Compute the total up front for a determinate progress bar.
  const buckets: { pass: PhotoPass; bucket: IncompleteDatePhotosGroup }[] = [];
  for (const pass of PHOTO_PASSES) {
    const list = await source.dateAlbumsList(pass.filter);
    for (const bucket of list) buckets.push({ pass, bucket });
  }
  const total = buckets.reduce((acc, b) => acc + b.bucket.numberOfItems, 0);
  upsertSyncState(db, "photo", { status: "running", progress_current: 0, progress_total: total });
  opts.onProgress?.({ entity: "photo", current: 0, total });

  const done = new Set(loadDoneBuckets(db));
  for (const { pass, bucket } of buckets) {
    const key = `${pass.name}:${bucket.id}`;
    if (done.has(key)) continue;
    const items = await collectBucket(source, bucket, pass.filter, maxPages);
    const rows = items.map((p) => pigPhotoToRemoteRow(p, mapOpts(opts, pass.flags, now)));
    written += upsertRemotePhotos(db, rows);
    done.add(key);
    saveProgress(db, done, written, total);
    opts.onProgress?.({ entity: "photo", current: written, total });
  }

  // No-timestamp photos (separate, paginated endpoint).
  written += await seedPhotosWithoutTimestamp(db, source, opts, now, maxPages);

  upsertSyncState(db, "photo", {
    status: "done",
    last_full_sync: now,
    progress_current: written,
    progress_total: Math.max(total, written),
  });
  return written;
}

async function seedPhotosWithoutTimestamp(
  db: AppDatabase,
  source: SeedSource,
  opts: SeedOptions,
  now: number,
  maxPages: number
): Promise<number> {
  let written = 0;
  for (let page = 1; page <= maxPages; page++) {
    const res = await source.photosWithoutTimestamp(page);
    const rows = (res.results ?? []).map((p) =>
      pigPhotoToRemoteRow({ ...p, date: null }, mapOpts(opts, {}, now))
    );
    written += upsertRemotePhotos(db, rows);
    if (!res.next || (res.results ?? []).length === 0) break;
  }
  return written;
}

/**
 * The photo pass persists completed date-bucket keys as a JSON array in
 * sync_state.cursor_id, so a resumed seed skips buckets it already ingested.
 */
function loadDoneBuckets(db: AppDatabase): string[] {
  const row = db.get(sql`SELECT cursor_id FROM sync_state WHERE entity = 'photo'`) as
    | { cursor_id: string | null }
    | undefined;
  if (!row?.cursor_id) return [];
  try {
    const parsed = JSON.parse(row.cursor_id) as unknown;
    return Array.isArray(parsed) ? (parsed as string[]) : [];
  } catch {
    return [];
  }
}

function saveProgress(db: AppDatabase, done: Set<string>, current: number, total: number): void {
  upsertSyncState(db, "photo", {
    status: "running",
    cursor_id: JSON.stringify([...done]),
    progress_current: current,
    progress_total: total,
  });
}

/* ---- people + albums --------------------------------------------------- */

export async function seedPeople(db: AppDatabase, source: SeedSource, now: number): Promise<number> {
  const list = await source.people();
  upsertSyncState(db, "person", { status: "running", progress_total: list.length });
  const rows = list.map((p) => ({
    id: p.id,
    name: p.name,
    kind: (p as { kind?: string }).kind ?? null,
    faceCount: p.face_count,
    coverPhotoHash: p.cover_photo ?? null,
    lastModified: now,
  }));
  upsertPersons(db, rows);
  upsertSyncState(db, "person", {
    status: "done",
    last_full_sync: now,
    progress_current: rows.length,
    progress_total: rows.length,
  });
  return rows.length;
}

export async function seedUserAlbums(
  db: AppDatabase,
  source: SeedSource,
  opts: SeedOptions,
  now: number
): Promise<number> {
  const list = await source.userAlbumsList();
  upsertSyncState(db, "user_album", { status: "running", progress_total: list.length });
  let done = 0;
  for (const info of list) {
    let photoIds: string[] | undefined;
    try {
      const detail = await source.userAlbum(info.id);
      photoIds = detail.grouped_photos.flatMap((g) => g.items.map((p) => p.id));
    } catch {
      photoIds = undefined; // metadata-only if detail fetch fails
    }
    upsertUserAlbums(db, [
      {
        id: info.id,
        title: info.title,
        ownerId: info.owner?.id ?? null,
        shared: (info.shared_to?.length ?? 0) > 0,
        favorited: info.favorited,
        coverHash: info.cover_photo?.image_hash ?? null,
        photoCount: info.photo_count,
        createdOn: parseServerTimestamp(info.created_on),
        lastModified: now,
        photoIds,
      },
    ]);
    done++;
    upsertSyncState(db, "user_album", {
      status: "running",
      progress_current: done,
      progress_total: list.length,
    });
    opts.onProgress?.({ entity: "user_album", current: done, total: list.length });
  }
  upsertSyncState(db, "user_album", {
    status: "done",
    last_full_sync: now,
    progress_current: done,
    progress_total: list.length,
  });
  return done;
}

export async function seedAutoAlbums(
  db: AppDatabase,
  source: SeedSource,
  opts: SeedOptions,
  now: number
): Promise<number> {
  const list = await source.autoAlbumsList();
  upsertSyncState(db, "auto_album", { status: "running", progress_total: list.length });
  let done = 0;
  for (const info of list) {
    let photoIds: string[] | undefined;
    let coverHash: string | null = null;
    try {
      const detail = await source.autoAlbum(info.id);
      photoIds = detail.photos.map((p) => p.image_hash);
      coverHash = detail.photos[0]?.image_hash ?? null;
    } catch {
      photoIds = undefined;
    }
    upsertAutoAlbums(db, [
      {
        id: info.id,
        title: info.title,
        timestamp: parseServerTimestamp(info.timestamp),
        favorited: info.favorited,
        photoCount: info.photo_count,
        coverHash,
        lastModified: now,
        photoIds,
      },
    ]);
    done++;
    upsertSyncState(db, "auto_album", {
      status: "running",
      progress_current: done,
      progress_total: list.length,
    });
    opts.onProgress?.({ entity: "auto_album", current: done, total: list.length });
  }
  upsertSyncState(db, "auto_album", {
    status: "done",
    last_full_sync: now,
    progress_current: done,
    progress_total: list.length,
  });
  return done;
}

export async function seedGroupingAlbums(
  db: AppDatabase,
  source: SeedSource,
  now: number
): Promise<void> {
  const [things, places, tags] = await Promise.all([
    source.thingAlbumsList(),
    source.placeAlbumsList(),
    source.tagAlbumsList(),
  ]);
  upsertThingAlbums(
    db,
    things.map((a) => ({
      id: a.id,
      title: a.title,
      photoCount: a.photo_count,
      coverHashes: a.cover_photos.map((c) => c.image_hash),
      lastModified: now,
    }))
  );
  upsertPlaceAlbums(
    db,
    places.map((a) => ({
      id: a.id,
      title: a.title,
      photoCount: a.photo_count,
      coverHashes: a.cover_photos.map((c) => c.image_hash),
      geolocationLevel: a.geolocation_level,
      lastModified: now,
    }))
  );
  upsertTagAlbums(
    db,
    tags.map((a) => ({
      id: a.id,
      title: a.name,
      photoCount: a.photo_count,
      coverHashes: a.cover_photos.map((c) => c.image_hash),
      lastModified: now,
    }))
  );
  for (const entity of ["thing_album", "place_album", "tag_album"] as const) {
    upsertSyncState(db, entity, { status: "done", last_full_sync: now });
  }
}

/** Run the full seed. Safe to re-run (pull-to-refresh) — all upserts converge. */
export async function seedAll(
  db: AppDatabase,
  source: SeedSource,
  opts: SeedOptions
): Promise<{ photos: number; people: number; userAlbums: number; autoAlbums: number }> {
  const now = opts.now ?? Date.now();
  const photos = await seedPhotos(db, source, { ...opts, now });
  const people = await seedPeople(db, source, now);
  const userAlbums = await seedUserAlbums(db, source, opts, now);
  const autoAlbums = await seedAutoAlbums(db, source, opts, now);
  await seedGroupingAlbums(db, source, now);
  opts.onProgress?.({ entity: "overall", current: 1, total: 1 });
  return { photos, people, userAlbums, autoAlbums };
}

export type { RemotePhotoInput };
