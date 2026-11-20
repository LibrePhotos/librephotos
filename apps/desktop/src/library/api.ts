/**
 * The library and server side of CONTRACT.md ("Library", "Server"). Every call the library view
 * makes goes through here: the library reads and writes the shared local database
 * (`packages/local-db`, src/db/) and Rust's file seams (./indexer), server calls go through
 * `packages/api-client` (`src/server/`). Outside Tauri the functions answer as an empty library
 * with no server, so the UI still renders in a plain browser.
 */
import {
  folderRoots,
  localAssetByUri,
  localAssetsByHash,
  localBackupCounts,
  localTimelineDays,
  localTimelinePage,
  recordServerHas,
  requestUpload,
  retryFailed,
  cancelFolderBackups,
  searchLocalAssets,
  setFileHashes,
  upsertLooseFile,
  type LibraryAssetRow,
  type LocalTimelineCursor,
} from "@librephotos/local-db";
import { bigThumbnailUrl, endpoints, squareThumbnailUrl } from "@librephotos/api-client/core";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { db } from "../db/database";
import { md5File, statPaths } from "../db/seams";
import { inTauri, type FileEntry, type FileKind } from "../ipc";
import { wakeBackup } from "../server/backup";
import { serverCall } from "../server/errors";
import { client, serverUrl, signIn, signedInUser, signOut } from "../server/session";
import { addRoot, removeRoot, rootOf, setRootsBackup, type LibraryProgress } from "./indexer";

export type { LibraryProgress };

/** What the server knows about a file: see CONTRACT.md "Server state". */
export type RemoteState = "unknown" | "checking" | "present" | "absent" | "uploading" | "failed";

export type LibraryFile = FileEntry & {
  id: string;
  width: number | null;
  height: number | null;
  /** Date taken (or modified) as local wall-clock milliseconds: read it with the UTC getters. */
  takenMs: number;
  dated: boolean;
  /** In a library folder (not a loose file). */
  inLibrary: boolean;
  remote: RemoteState;
  md5: string | null;
};

export type Root = { id: string; path: string; fileCount: number };
export type LibraryStatus = { root: Root | null; file: LibraryFile | null };

export type RemoteCounts = {
  total: number;
  unknown: number;
  present: number;
  absent: number;
  uploading: number;
  failed: number;
  wanted: number;
  pendingBytes: number;
};
export type Upload = { name: string; sent: number; total: number };
export type ServerStatus = {
  connected: boolean;
  url: string | null;
  username: string | null;
  userId: number | null;
  backup: boolean;
  paused: boolean;
  error: string | null;
  counts: RemoteCounts;
  uploads: Upload[];
  rate: number;
  uploadedFiles: number;
  uploadedBytes: number;
};
export type RemoteOf = {
  state: RemoteState;
  photoId: string | null;
  md5: string | null;
  imageHash: string | null;
  inLibrary: boolean;
};
export type HashMatch = { hash: string; file: LibraryFile };

const EMPTY_COUNTS: RemoteCounts = { total: 0, unknown: 0, present: 0, absent: 0, uploading: 0, failed: 0, wanted: 0, pendingBytes: 0 };
export const OFFLINE_STATUS: ServerStatus = {
  connected: false,
  url: null,
  username: null,
  userId: null,
  backup: false,
  paused: false,
  error: null,
  counts: EMPTY_COUNTS,
  uploads: [],
  rate: 0,
  uploadedFiles: 0,
  uploadedBytes: 0,
};

const notInBrowser = () => Promise.reject(new Error("only in the desktop app"));

// ------------------------------------------------------------------ rows -> files

const KINDS: readonly FileKind[] = ["image", "raw", "video"];
const kindOf = (t: string | null): FileKind => KINDS.find(k => k === t) ?? "image";

/** Real epoch ms as local wall-clock ms (what an undated file's date reads as with UTC getters). */
const wallClock = (ms: number) => ms - new Date(ms).getTimezoneOffset() * 60_000;

function remoteOf(row: LibraryAssetRow): RemoteState {
  if (row.on_server) return "present";
  switch (row.upload_state) {
    case "uploading":
      return "uploading";
    case "checking":
      return "checking";
    case "failed":
      return "failed";
    case "pending":
      return "absent";
    default:
      return "unknown";
  }
}

export function fileOf(row: LibraryAssetRow): LibraryFile {
  const path = row.uri ?? row.id;
  const created = row.created_at ?? row.modified_at ?? 0;
  const dated = row.dated === 1;
  return {
    id: row.id,
    path,
    name: row.name ?? path.split(/[\\/]/).pop() ?? path,
    size: row.size_bytes ?? 0,
    modifiedMs: row.modified_at ?? 0,
    kind: kindOf(row.type),
    width: row.width,
    height: row.height,
    takenMs: dated ? created : wallClock(created),
    dated,
    inLibrary: row.in_library === 1,
    remote: remoteOf(row),
    md5: row.hash ? row.hash.slice(0, 32) : null,
  };
}

// ------------------------------------------------------------------ library

export const libraryRoots = async (): Promise<Root[]> =>
  inTauri ? (await folderRoots(db)).map(r => ({ id: r.id, path: r.path, fileCount: r.file_count })) : [];

export const addLibraryRoot = async (path: string): Promise<Root> => {
  if (!inTauri) return notInBrowser();
  const r = await addRoot(path);
  return { id: r.id, path: r.path, fileCount: r.file_count };
};

export const removeLibraryRoot = (id: string): Promise<void> => (inTauri ? removeRoot(id) : notInBrowser());

/** Rows per keyset page of the timeline. */
const PAGE_ROWS = 5000;

/** Library files (of one root, or all), newest first: the timeline read page by page. */
export async function libraryFiles(rootId: string | null): Promise<LibraryFile[]> {
  if (!inTauri) return [];
  const out: LibraryFile[] = [];
  let cursor: LocalTimelineCursor | null = null;
  do {
    const page: { rows: LibraryAssetRow[]; nextCursor: LocalTimelineCursor | null } = await localTimelinePage(db, {
      rootId,
      limit: PAGE_ROWS,
      cursor,
    });
    for (const row of page.rows) out.push(fileOf(row));
    cursor = page.nextCursor;
  } while (cursor);
  return out;
}

/** Day buckets (headers, the "N days" line) of the library or one root. */
export const libraryDays = async (rootId: string | null): Promise<number> =>
  inTauri ? (await localTimelineDays(db, { rootId })).length : 0;

export const librarySearch = async (query: string, rootId: string | null = null): Promise<LibraryFile[]> =>
  inTauri ? (await searchLocalAssets(db, query, { rootId, limit: 5000 })).map(fileOf) : [];

/** The local files of server `image_hash`es (MD5 hex + user id), library files first. */
export async function libraryByHashes(hashes: string[]): Promise<HashMatch[]> {
  if (!inTauri || hashes.length === 0) return [];
  const rows = await localAssetsByHash(db, hashes);
  const out: HashMatch[] = [];
  for (const hash of hashes) {
    const matches = rows.filter(r => r.hash === hash).sort((a, b) => b.in_library - a.in_library);
    const first = matches[0];
    if (first) out.push({ hash, file: fileOf(first) });
  }
  return out;
}

export async function libraryStatus(path: string): Promise<LibraryStatus> {
  if (!inTauri) return { root: null, file: null };
  const r = await rootOf(path);
  const row = await localAssetByUri(db, path);
  return {
    root: r ? { id: r.id, path: r.path, fileCount: r.file_count } : null,
    file: row && row.in_library === 1 ? fileOf(row) : null,
  };
}

// ------------------------------------------------------------------ server

/** What Rust knows about the connection plus the library's backup counts; `useServerStatus` adds the engine's progress. */
export type ServerState = Pick<ServerStatus, "connected" | "url" | "username" | "userId" | "backup" | "paused" | "error" | "counts">;

async function backupCounts(): Promise<RemoteCounts> {
  const c = await localBackupCounts(db, "folder");
  const queued = c.pending + c.checking + c.uploading + c.failed;
  return {
    total: c.total,
    present: c.onServer,
    absent: c.pending,
    uploading: c.uploading,
    failed: c.failed,
    unknown: c.checking + (c.total - c.hashed),
    wanted: queued,
    pendingBytes: c.pendingBytes,
  };
}

export async function serverState(): Promise<ServerState> {
  if (!inTauri) return OFFLINE_STATUS;
  const [rust, counts] = await Promise.all([invoke<Omit<ServerState, "counts">>("server_status"), backupCounts()]);
  return { ...rust, counts };
}

/** Signs in with the shared api-client (`endpoints.login`); see `src/server/session.ts`. */
export const serverConnect = (url: string, username: string, password: string): Promise<void> => signIn(url, username, password);
export const serverDisconnect = (): Promise<void> => signOut();

export const serverSetBackup = async (on: boolean): Promise<void> => {
  if (!inTauri) return notInBrowser();
  await invoke<void>("server_set_backup", { on });
  await setRootsBackup(on);
  if (!on) await cancelFolderBackups(db);
  wakeBackup();
};
export const serverSetPaused = async (paused: boolean): Promise<void> => {
  if (!inTauri) return notInBrowser();
  await invoke<void>("server_set_paused", { paused });
  wakeBackup();
};
export const serverRetryFailed = async (): Promise<number> => {
  if (!inTauri) return 0;
  const n = await retryFailed(db);
  wakeBackup();
  return n;
};

/** The row of a local file (a loose row when it is outside the library) and its MD5, hashed now if needed. */
async function localRow(path: string): Promise<{ row: LibraryAssetRow; md5: string | null }> {
  let row = await localAssetByUri(db, path);
  const [entry] = await statPaths([path]);
  if (!entry) throw new Error(`${path} is not a picture or video`);
  if (!row || row.size_bytes !== entry.size || row.modified_at !== entry.mtimeMs) {
    await upsertLooseFile(db, entry);
    row = await localAssetByUri(db, path);
  }
  if (!row) throw new Error(`${path} vanished`);
  const userId = signedInUser();
  if (row.hash || userId === null) return { row, md5: row.hash ? row.hash.slice(0, 32) : null };
  const md5 = await md5File(path);
  await setFileHashes(db, [{ path, md5 }], userId);
  return { row: (await localAssetByUri(db, path)) ?? row, md5 };
}

/** Queues one file (in the library or not) for upload, whatever the backup switch says. */
export const serverUploadFile = async (path: string): Promise<RemoteOf> => {
  if (!inTauri) return notInBrowser();
  const { row, md5 } = await localRow(path);
  await requestUpload(db, row.id);
  wakeBackup();
  return { state: remoteOf(row), photoId: null, md5, imageHash: null, inLibrary: row.in_library === 1 };
};

/**
 * What the server knows about a local file: its MD5 (hashed now when unknown), then
 * `uploadExists` (api-client); a "yes" is stored for the badges and the backup.
 */
export async function serverRemoteOf(path: string): Promise<RemoteOf> {
  if (!inTauri) return notInBrowser();
  const { row, md5 } = await localRow(path);
  const userId = signedInUser();
  const local: RemoteOf = {
    state: remoteOf(row),
    photoId: null,
    md5,
    imageHash: md5 && userId !== null ? `${md5}${userId}` : null,
    inLibrary: row.in_library === 1,
  };
  if (userId === null || !md5 || local.state === "uploading") return local;
  const answer = await serverCall(() => endpoints.uploadExists(client, md5, userId));
  if (answer.exists) {
    const photoId = answer.photo_id ?? null;
    await recordServerHas(db, row.id, photoId);
    return { ...local, state: "present", photoId };
  }
  return { ...local, state: local.state === "failed" || local.state === "absent" ? local.state : "absent" };
}

/**
 * A server thumbnail through the signed-in session (`lpview` `/remote`, cached on disk). The URL
 * is the one `packages/api-client`'s media helpers build; Rust only fetches it.
 */
export function remoteThumbUrl(imageHash: string, kind: "square" | "big" = "square"): string {
  const server = serverUrl() ?? "";
  const src = kind === "big" ? bigThumbnailUrl(server, imageHash) : squareThumbnailUrl(server, imageHash);
  const base = navigator.userAgent.includes("Windows") ? "http://lpview.localhost" : "lpview://localhost";
  return `${base}/remote?src=${encodeURIComponent(src)}`;
}

function on<T>(event: string, handler: (payload: T) => void): () => void {
  if (!inTauri) return () => undefined;
  let unlisten: UnlistenFn | null = null;
  let disposed = false;
  void listen<T>(event, e => handler(e.payload)).then(fn => {
    if (disposed) fn();
    else unlisten = fn;
  });
  return () => {
    disposed = true;
    unlisten?.();
  };
}

/** The connection or the backup switch changed: ask `serverState` again. */
export const onServerStatus = (handler: () => void) => on<null>("server://status", () => handler());
