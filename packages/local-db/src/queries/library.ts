/**
 * The desktop's folder library on the shared tables.
 *
 * A folder the user added is a `local_album` with `source = 'folder'` and its
 * absolute `path`; each file under it is a `local_asset` (its `uri` is the file
 * path) linked to the root through `local_album_asset`. Files are referenced in
 * place. The desktop's file seams hand their findings to the writers here as
 * data: walk batches and the watcher's created/modified files to
 * {@link upsertWalkedFiles}, removed paths (files or whole folders) to
 * {@link removeLocalPaths}, renames to {@link renameLocalPaths} (the row, its
 * hash and upload state survive), metadata reads for the files
 * {@link pendingMetadata} hands out to {@link applyFileMetadata}, and MD5s to
 * {@link setFileHashes}. Backup runs through `upload_queue` (./upload-queue),
 * search through ./local-search.
 *
 * Dates follow the desktop: a file sorts by its date taken as wall-clock ms
 * (`takenMs`, its day read with UTC getters) once its metadata is read, and by
 * its mtime (its day in the local time zone) until then or when it has none.
 *
 * A file that is in no folder root (a "loose" file opened from elsewhere that
 * the user asked to upload) is a local_asset without a root link: it never shows
 * in these views but shares the hash cache and the upload queue.
 */
import { sql, type SQL } from "drizzle-orm";
import { runBatch } from "../batch";
import { HASH_STATE_UNREADABLE } from "../schema";
import type { AppDatabase } from "../types";
import { chunk, inList, BATCH_SIZE } from "../writers";

/* ---- folder roots ------------------------------------------------------- */

export type FolderRoot = {
  id: string;
  path: string;
  title: string | null;
  backup_selection: number;
  added_at: number | null;
  /** Files currently linked to the root. */
  file_count: number;
};

/** Every added folder with its file count, by path. */
export function folderRoots(db: AppDatabase): Promise<FolderRoot[]> {
  return db.all<FolderRoot>(
    sql`SELECT l.id AS id, l.path AS path, l.title AS title, l.backup_selection AS backup_selection,
               l.added_at AS added_at,
               (SELECT COUNT(*) FROM local_album_asset laa WHERE laa.album_id = l.id) AS file_count
        FROM local_album l WHERE l.source = 'folder'
        ORDER BY l.path`
  );
}

/**
 * Add a folder root (or find the one already added at `path`). Returns its id:
 * `id` for a new root, the existing root's id otherwise.
 */
export async function addFolderRoot(
  db: AppDatabase,
  root: { id: string; path: string; title: string; backup?: boolean },
  now = Date.now()
): Promise<string> {
  const [, existing] = await db.batch([
    db.run(
      sql`INSERT INTO local_album (id, title, source, path, added_at, backup_selection)
          VALUES (${root.id}, ${root.title}, 'folder', ${root.path}, ${now}, ${root.backup ? 1 : 0})
          ON CONFLICT DO NOTHING`
    ),
    db.get<{ id: string } | undefined>(sql`SELECT id FROM local_album WHERE path = ${root.path}`),
  ]);
  return existing?.id ?? root.id;
}

/** Live uploads keep their file even when it leaves the library (it becomes a loose file). */
const LIVE_UPLOAD = sql`EXISTS (SELECT 1 FROM upload_queue uq WHERE uq.asset_id = la.id
                                AND uq.state IN ('pending', 'checking', 'uploading'))`;

/** Files of `rootId` that are in no other album and have no live upload. */
function orphansOf(rootId: string): SQL {
  return sql`SELECT la.id FROM local_asset la
             JOIN local_album_asset laa ON laa.asset_id = la.id AND laa.album_id = ${rootId}
             WHERE NOT EXISTS (SELECT 1 FROM local_album_asset o WHERE o.asset_id = la.id AND o.album_id <> ${rootId})
               AND NOT ${LIVE_UPLOAD}`;
}

/** Remove a folder root and its files (files with a live upload stay, as loose files). */
export async function removeFolderRoot(db: AppDatabase, rootId: string): Promise<void> {
  await runBatch(db, [
    sql`DELETE FROM upload_queue WHERE asset_id IN (${orphansOf(rootId)})`,
    sql`DELETE FROM local_asset WHERE id IN (${orphansOf(rootId)})`,
    sql`DELETE FROM local_album_asset WHERE album_id = ${rootId}`,
    sql`DELETE FROM local_album WHERE id = ${rootId}`,
  ]);
}

/** Move every file of root `fromId` to root `toId` (a new root that contains an old one), then drop `fromId`. */
export async function mergeFolderRoot(db: AppDatabase, fromId: string, toId: string): Promise<void> {
  await runBatch(db, [
    sql`INSERT OR IGNORE INTO local_album_asset (album_id, asset_id)
        SELECT ${toId}, asset_id FROM local_album_asset WHERE album_id = ${fromId}`,
    sql`DELETE FROM local_album_asset WHERE album_id = ${fromId}`,
    sql`DELETE FROM local_album WHERE id = ${fromId}`,
  ]);
}

/** Whether a root is backed up: `local_album.backup_selection` 1 (yes) or 0. */
export async function setFolderBackup(db: AppDatabase, rootId: string, backup: boolean): Promise<void> {
  await db.run(sql`UPDATE local_album SET backup_selection = ${backup ? 1 : 0} WHERE id = ${rootId}`);
}

/* ---- files: what the desktop's file seams report ----------------------- */

/** A file a directory walk or the watcher found (the desktop's `FsEntry`). */
export type WalkedFile = {
  /** Absolute path; becomes `uri` (and the id of a new row). */
  path: string;
  /** Absolute path of the folder the file is in. */
  folder: string;
  name: string;
  size: number;
  /** File mtime, ms epoch. */
  mtimeMs: number;
  kind: "image" | "raw" | "video";
};

const SEPARATORS = /[\\/]+/;

function trimSeparators(path: string): string {
  return path.replace(/[\\/]+$/, "");
}

/**
 * The searchable folder of a file: the added folder's own name, then the
 * subfolders down to the file, joined with "/" ("Pictures/Holiday 2019/Day 1").
 * Words above the added folder ("C:", "Users") are left out: they would match
 * every file.
 */
export function folderWords(rootPath: string, folder: string): string {
  const root = trimSeparators(rootPath);
  const rootName = root.split(SEPARATORS).pop() ?? root;
  const inside = trimSeparators(folder);
  const rest =
    inside.length > root.length && inside.slice(0, root.length).toLowerCase() === root.toLowerCase()
      ? inside.slice(root.length)
      : "";
  return [rootName, ...rest.split(SEPARATORS).filter((part) => part.length > 0)].join("/");
}

function dirname(path: string): string {
  const parts = trimSeparators(path).split(SEPARATORS);
  const cut = trimSeparators(path).length - (parts[parts.length - 1]?.length ?? 0);
  return trimSeparators(path.slice(0, cut));
}

function basename(path: string): string {
  return trimSeparators(path).split(SEPARATORS).pop() ?? path;
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/** 'YYYY-MM-DD' of a real epoch ms in the local time zone (a file's mtime). */
export function localDay(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** 'YYYY-MM-DD' of wall-clock ms read with UTC getters (the desktop's `takenMs`). */
export function wallClockDay(ms: number): string {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

/** `la.uri` is `path` or lies below it (either separator). */
function atOrBelow(path: string, column = sql`uri`): SQL {
  const p = trimSeparators(path);
  return sql`(${column} = ${p} OR substr(${column}, 1, ${p.length + 1}) IN (${`${p}/`}, ${`${p}\\`}))`;
}

/** Files per {@link upsertWalkedFiles} statement (7 parameters each, well under SQLite's 32,766). */
const WALK_CHUNK = 500;

/**
 * Record what a walk (or the watcher's `created` / `modified`) found under a
 * folder root. Rows are matched by path. A new file gets its path as id and
 * `meta_state = 'pending'`; a known file whose size or mtime changed is new
 * content, so its hash and metadata are dropped and asked for again, while an
 * unchanged one keeps both (a rescan costs nothing). Each file is linked to the
 * root. One batch (three statements) per chunk of 500. Returns the number of files written.
 */
export async function upsertWalkedFiles(
  db: AppDatabase,
  root: { id: string; path: string },
  files: readonly WalkedFile[]
): Promise<number> {
  // One row per path (the last report wins): a path twice in one INSERT would collide with itself.
  const unique = [...new Map(files.map((f) => [f.path, f])).values()];
  for (const batch of chunk(unique, WALK_CHUNK)) {
    // The chunk as a table (path, name, folder, size, mtime, kind, day): three statements per
    // chunk instead of three per file, which makes a 2,000-file walk several times faster.
    const values = sql.join(
      batch.map(
        (f) =>
          sql`(${f.path}, ${f.name}, ${folderWords(root.path, f.folder)}, ${f.size}, ${f.mtimeMs}, ${f.kind}, ${localDay(f.mtimeMs)})`
      ),
      sql`, `
    );
    const w = sql`WITH w(path, name, folder, size, mtime, kind, day) AS (VALUES ${values})`;
    const changed = sql`(local_asset.size_bytes IS NOT w.size OR local_asset.modified_at IS NOT w.mtime)`;
    await runBatch(db, [
      sql`${w}
          UPDATE local_asset SET
            name = w.name, folder = w.folder, type = w.kind,
            hash = CASE WHEN ${changed} THEN NULL ELSE local_asset.hash END,
            hashed_at = CASE WHEN ${changed} THEN NULL ELSE local_asset.hashed_at END,
            hash_state = CASE WHEN ${changed} THEN NULL ELSE local_asset.hash_state END,
            meta_state = CASE WHEN ${changed} THEN 'pending' ELSE local_asset.meta_state END,
            taken_at = CASE WHEN ${changed} THEN NULL ELSE local_asset.taken_at END,
            created_at = CASE WHEN ${changed} THEN w.mtime ELSE local_asset.created_at END,
            bucket_day = CASE WHEN ${changed} THEN w.day ELSE local_asset.bucket_day END,
            size_bytes = w.size, modified_at = w.mtime
          FROM w WHERE local_asset.uri = w.path`,
      sql`${w}
          INSERT INTO local_asset (id, uri, name, folder, size_bytes, modified_at, type, created_at, bucket_day, meta_state)
          SELECT w.path, w.path, w.name, w.folder, w.size, w.mtime, w.kind, w.mtime, w.day, 'pending' FROM w
          WHERE NOT EXISTS (SELECT 1 FROM local_asset la WHERE la.uri = w.path)`,
      sql`${w}
          INSERT OR IGNORE INTO local_album_asset (album_id, asset_id)
          SELECT ${root.id}, la.id FROM w JOIN local_asset la ON la.uri = w.path`,
    ]);
  }
  return files.length;
}

/**
 * A "loose" file: one the user opened from outside the library and asked about
 * or to upload. It gets a local_asset row (matched by path, its id the path)
 * without a root link, so it shares the hash cache and the upload queue but
 * never shows in the library views. A changed file loses its hash. Returns the
 * row's id.
 */
export async function upsertLooseFile(db: AppDatabase, f: WalkedFile): Promise<string> {
  const day = localDay(f.mtimeMs);
  const changed = sql`(size_bytes IS NOT ${f.size} OR modified_at IS NOT ${f.mtimeMs})`;
  const [, , row] = await db.batch([
    db.run(
      sql`UPDATE local_asset SET
            hash = CASE WHEN ${changed} THEN NULL ELSE hash END,
            hashed_at = CASE WHEN ${changed} THEN NULL ELSE hashed_at END,
            hash_state = CASE WHEN ${changed} THEN NULL ELSE hash_state END,
            size_bytes = ${f.size}, modified_at = ${f.mtimeMs}
          WHERE uri = ${f.path}`
    ),
    db.run(
      sql`INSERT INTO local_asset (id, uri, name, folder, size_bytes, modified_at, type, created_at, bucket_day, meta_state)
          SELECT ${f.path}, ${f.path}, ${f.name}, NULL, ${f.size}, ${f.mtimeMs}, ${f.kind}, ${f.mtimeMs}, ${day}, 'done'
          WHERE NOT EXISTS (SELECT 1 FROM local_asset WHERE uri = ${f.path})`
    ),
    db.get<{ id: string } | undefined>(sql`SELECT id FROM local_asset WHERE uri = ${f.path}`),
  ]);
  return row?.id ?? f.path;
}

/** Live uploads keep their file even when it leaves the library (it becomes a loose file). */
const NO_LIVE_UPLOAD = sql`NOT EXISTS (SELECT 1 FROM upload_queue uq WHERE uq.asset_id = local_asset.id
                                       AND uq.state IN ('pending', 'checking', 'uploading'))`;

/**
 * Forget paths that are gone (the watcher's `removed`): each path and
 * everything below it, since a removed folder is one path. Finished upload rows
 * go with them; a file with a live upload stays as a loose file (no root).
 */
export async function removeLocalPaths(db: AppDatabase, paths: readonly string[]): Promise<void> {
  for (const batch of chunk(paths, 200)) {
    const anyOf = sql.join(
      batch.map((p) => atOrBelow(p)),
      sql` OR `
    );
    const ids = sql`SELECT id FROM local_asset WHERE ${anyOf}`;
    await runBatch(db, [
      sql`DELETE FROM upload_queue WHERE asset_id IN (${ids}) AND state NOT IN ('pending', 'checking', 'uploading')`,
      sql`DELETE FROM local_album_asset WHERE asset_id IN (${ids})`,
      sql`DELETE FROM local_asset WHERE (${anyOf}) AND ${NO_LIVE_UPLOAD}`,
    ]);
  }
}

/**
 * Apply renames inside a root (the watcher's `renamed`). The row stays, so its
 * hash, metadata and upload state survive; only path, name and folder words
 * change. A folder rename moves every file below it. A file already at the
 * new path (overwritten by the rename) is dropped first.
 */
export async function renameLocalPaths(
  db: AppDatabase,
  root: { id: string; path: string },
  renames: readonly { from: string; to: string; dir: boolean }[]
): Promise<void> {
  const statements: SQL[] = [];
  for (const r of renames) {
    const from = trimSeparators(r.from);
    const to = trimSeparators(r.to);
    if (!r.dir) {
      statements.push(
        sql`DELETE FROM local_album_asset WHERE asset_id IN (SELECT id FROM local_asset WHERE uri = ${to} AND uri <> ${from})`,
        sql`DELETE FROM local_asset WHERE uri = ${to} AND uri <> ${from}`,
        sql`UPDATE local_asset SET uri = ${to}, name = ${basename(to)}, folder = ${folderWords(root.path, dirname(to))}
            WHERE uri = ${from}`
      );
      continue;
    }
    const fromWords = folderWords(root.path, from);
    const toWords = folderWords(root.path, to);
    statements.push(
      sql`UPDATE local_asset SET
            uri = ${to} || substr(uri, ${from.length + 1}),
            folder = CASE
              WHEN folder = ${fromWords} THEN ${toWords}
              WHEN substr(folder, 1, ${fromWords.length + 1}) = ${`${fromWords}/`} THEN ${toWords} || substr(folder, ${fromWords.length + 1})
              ELSE folder END
          WHERE substr(uri, 1, ${from.length + 1}) IN (${`${from}/`}, ${`${from}\\`})`
    );
  }
  await runBatch(db, statements);
}

/** The (path, size, mtime) of every file of a root, for a walk to diff against. */
export function knownFolderFiles(
  db: AppDatabase,
  rootId: string
): Promise<{ id: string; uri: string; size_bytes: number | null; modified_at: number | null }[]> {
  return db.all(
    sql`SELECT la.id AS id, la.uri AS uri, la.size_bytes AS size_bytes, la.modified_at AS modified_at
        FROM local_album_asset laa JOIN local_asset la ON la.id = laa.asset_id
        WHERE laa.album_id = ${rootId}`
  );
}

/* ---- metadata pass ------------------------------------------------------ */

/** Files waiting for their metadata, most recently modified first. */
export function pendingMetadata(db: AppDatabase, limit: number): Promise<{ id: string; uri: string }[]> {
  return db.all(
    sql`SELECT id, uri FROM local_asset WHERE meta_state = 'pending' AND uri IS NOT NULL
        ORDER BY modified_at DESC LIMIT ${limit}`
  );
}

/** What the desktop reads from a file's headers (its `FileMeta`). */
export type FileMetadata = {
  path: string;
  format: string | null;
  width: number | null;
  height: number | null;
  /** ISO 8601 local time; null when the file has no date (its mtime stays the sort time). */
  takenAt: string | null;
  /** `takenAt` as wall-clock ms (read with UTC getters). */
  takenMs: number | null;
  camera: string | null;
  lens: string | null;
  lat: number | null;
  lon: number | null;
};

/**
 * Store a batch of metadata reads, matched by path. A dated file sorts by its
 * date taken from now on (`created_at`, `bucket_day`); `failed` lists the paths
 * that could not be read, which are not asked for again until they change.
 */
export async function applyFileMetadata(
  db: AppDatabase,
  metas: readonly FileMetadata[],
  failed: readonly string[] = []
): Promise<void> {
  for (const batch of chunk(metas, BATCH_SIZE)) {
    await runBatch(
      db,
      batch.map((m) => {
        const dated = m.takenAt != null && m.takenMs != null;
        const created = dated ? sql`${m.takenMs}` : sql`created_at`;
        const day = dated && m.takenMs != null ? sql`${wallClockDay(m.takenMs)}` : sql`bucket_day`;
        return sql`UPDATE local_asset SET meta_state = 'done', width = ${m.width}, height = ${m.height},
                     taken_at = ${m.takenAt}, camera = ${m.camera}, lens = ${m.lens},
                     latitude = ${m.lat}, longitude = ${m.lon}, format = ${m.format},
                     created_at = ${created}, bucket_day = ${day}
                   WHERE uri = ${m.path}`;
      })
    );
  }
  for (const batch of chunk(failed, BATCH_SIZE)) {
    await db.run(sql`UPDATE local_asset SET meta_state = 'failed' WHERE uri IN (${inList(batch)})`);
  }
}

/**
 * Store MD5s the desktop computed, matched by path, in the form the server
 * matches photos by (`image_hash` = md5 + user id).
 */
export async function setFileHashes(
  db: AppDatabase,
  hashes: readonly { path: string; md5: string }[],
  userId: number,
  now = Date.now()
): Promise<void> {
  for (const batch of chunk(hashes, BATCH_SIZE)) {
    await runBatch(
      db,
      batch.map(
        (h) =>
          sql`UPDATE local_asset SET hash = ${h.md5 + String(userId)}, hashed_at = ${now}, hash_state = NULL
              WHERE uri = ${h.path}`
      )
    );
  }
}

/**
 * Files the desktop could not read to hash (gone, locked): {@link pendingHashes}
 * skips them until a walk or the watcher sees them change.
 */
export async function markHashUnreadable(db: AppDatabase, paths: readonly string[]): Promise<void> {
  for (const batch of chunk(paths, BATCH_SIZE)) {
    await db.run(
      sql`UPDATE local_asset SET hash_state = ${HASH_STATE_UNREADABLE} WHERE uri IN (${inList(batch)}) AND hash IS NULL`
    );
  }
}

/* ---- library views ------------------------------------------------------ */

/** Which part of the folder library a view covers: one root, or every root. */
export type LibraryScope = { rootId?: string | null };

/** `la` is in the folder library (or in root `rootId`). Constant SQL plus bound values. */
export function libraryScope(scope: LibraryScope): SQL {
  return scope.rootId
    ? sql`EXISTS (SELECT 1 FROM local_album_asset laa WHERE laa.asset_id = la.id AND laa.album_id = ${scope.rootId})`
    : sql`EXISTS (SELECT 1 FROM local_album_asset laa JOIN local_album l ON l.id = laa.album_id
                  WHERE laa.asset_id = la.id AND l.source = 'folder')`;
}

const DAY = sql`COALESCE(la.bucket_day, strftime('%Y-%m-%d', la.created_at / 1000, 'unixepoch', 'localtime'))`;

/** A file as the library views show it. */
export type LibraryAssetRow = {
  id: string;
  uri: string | null;
  name: string | null;
  type: string | null;
  width: number | null;
  height: number | null;
  created_at: number | null;
  bucket_day: string | null;
  size_bytes: number | null;
  hash: string | null;
  meta_state: string | null;
  /** 1 when the file's metadata gave it a date. */
  dated: number;
  /** The file's upload_queue state, if it has a row. */
  upload_state: string | null;
  /** 1 when the server has a photo with the file's hash (per the mirror) or the upload finished. */
  on_server: number;
  /** File mtime, ms epoch. */
  modified_at: number | null;
  /** 1 when the file is in a folder root (not a loose file). */
  in_library: number;
};

export const LIBRARY_ASSET_COLUMNS = sql`la.id AS id, la.uri AS uri, la.name AS name, la.type AS type,
  la.width AS width, la.height AS height, la.created_at AS created_at, ${DAY} AS bucket_day,
  la.size_bytes AS size_bytes, la.hash AS hash, la.meta_state AS meta_state,
  (la.taken_at IS NOT NULL) AS dated,
  (SELECT uq.state FROM upload_queue uq WHERE uq.asset_id = la.id) AS upload_state,
  (EXISTS (SELECT 1 FROM remote_photo rp WHERE la.hash IS NOT NULL AND rp.image_hash = la.hash)
   OR EXISTS (SELECT 1 FROM upload_queue uq WHERE uq.asset_id = la.id AND uq.state IN ('done', 'skipped_exists'))) AS on_server,
  la.modified_at AS modified_at,
  EXISTS (SELECT 1 FROM local_album_asset laa JOIN local_album l ON l.id = laa.album_id
          WHERE laa.asset_id = la.id AND l.source = 'folder') AS in_library`;

/** Day headers / scrubber buckets of the folder library, newest day first. */
export function localTimelineDays(db: AppDatabase, scope: LibraryScope = {}): Promise<{ bucket_day: string; count: number }[]> {
  return db.all(
    sql`SELECT ${DAY} AS bucket_day, COUNT(*) AS count FROM local_asset la
        WHERE la.created_at IS NOT NULL AND ${libraryScope(scope)}
        GROUP BY 1 ORDER BY 1 DESC`
  );
}

export type LocalTimelineCursor = { createdAt: number; id: string };

/** One keyset page of the folder library, newest first (`idx_local_asset_timeline` order). */
export async function localTimelinePage(
  db: AppDatabase,
  opts: LibraryScope & { limit: number; cursor?: LocalTimelineCursor | null }
): Promise<{ rows: LibraryAssetRow[]; nextCursor: LocalTimelineCursor | null }> {
  const after = opts.cursor ? sql`(la.created_at, la.id) < (${opts.cursor.createdAt}, ${opts.cursor.id})` : sql`1 = 1`;
  const rows = await db.all<LibraryAssetRow>(
    sql`SELECT ${LIBRARY_ASSET_COLUMNS} FROM local_asset la
        WHERE la.created_at IS NOT NULL AND ${libraryScope(opts)} AND ${after}
        ORDER BY la.created_at DESC, la.id DESC
        LIMIT ${opts.limit}`
  );
  const last = rows[rows.length - 1];
  const nextCursor =
    rows.length === opts.limit && last && last.created_at != null ? { createdAt: last.created_at, id: last.id } : null;
  return { rows, nextCursor };
}

/** Library files by hash (several copies of one picture share it). */
export function localAssetsByHash(db: AppDatabase, hashes: readonly string[]): Promise<LibraryAssetRow[]> {
  if (hashes.length === 0) return Promise.resolve([]);
  return db.all<LibraryAssetRow>(
    sql`SELECT ${LIBRARY_ASSET_COLUMNS} FROM local_asset la WHERE la.hash IN (${inList(hashes)})
        ORDER BY la.created_at DESC`
  );
}

/** A local asset by its uri (the desktop: by file path). */
export async function localAssetByUri(db: AppDatabase, uri: string): Promise<LibraryAssetRow | null> {
  const row = await db.get<LibraryAssetRow | undefined>(
    sql`SELECT ${LIBRARY_ASSET_COLUMNS} FROM local_asset la WHERE la.uri = ${uri} LIMIT 1`
  );
  return row ?? null;
}

/** How far indexing is: library files, and those still waiting for their metadata or hash. */
export async function libraryProgress(
  db: AppDatabase
): Promise<{ files: number; pendingMetadata: number; pendingHashes: number }> {
  const row = await db.get<{ files: number; pending_meta: number | null; pending_hash: number | null } | undefined>(
    sql`SELECT COUNT(*) AS files, SUM(la.meta_state = 'pending') AS pending_meta,
               SUM(la.hash IS NULL AND la.hash_state IS NULL) AS pending_hash
        FROM local_asset la WHERE ${libraryScope({})}`
  );
  return { files: row?.files ?? 0, pendingMetadata: row?.pending_meta ?? 0, pendingHashes: row?.pending_hash ?? 0 };
}

/** Library files still waiting for a hash, most recent first. */
export function pendingHashes(db: AppDatabase, limit: number): Promise<{ id: string; uri: string }[]> {
  return db.all(
    sql`SELECT la.id AS id, la.uri AS uri FROM local_asset la
        WHERE la.hash IS NULL AND la.hash_state IS NULL AND la.uri IS NOT NULL AND ${libraryScope({})}
        ORDER BY la.modified_at DESC LIMIT ${limit}`
  );
}
