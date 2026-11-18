/**
 * The library and server side of CONTRACT.md ("Library", "Server"). Every call the library view
 * makes goes through here: library calls into Rust, server calls through `packages/api-client`
 * (`src/server/`). Outside Tauri the functions answer as an empty library with no server, so the
 * UI still renders in a plain browser.
 */
import { bigThumbnailUrl, endpoints, squareThumbnailUrl } from "@librephotos/api-client/core";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { inTauri, type FileEntry } from "../ipc";
import { wakeBackup } from "../server/backup";
import { serverCall } from "../server/errors";
import { client, serverUrl, signIn, signedInUser, signOut } from "../server/session";

/** What the server knows about a file: see CONTRACT.md "Server state". */
export type RemoteState = "unknown" | "checking" | "present" | "absent" | "uploading" | "failed";

export type LibraryFile = FileEntry & {
  id: number;
  width: number | null;
  height: number | null;
  /** Date taken (or modified) as local wall-clock milliseconds: read it with the UTC getters. */
  takenMs: number;
  dated: boolean;
  rootId: number | null;
  remote: RemoteState;
  remoteId: string | null;
  md5: string | null;
};

export type Root = { id: number; path: string; fileCount: number };
export type LibraryProgress = { walking: boolean; files: number; pending: number };
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

export const libraryRoots = (): Promise<Root[]> => (inTauri ? invoke<Root[]>("library_roots") : Promise.resolve([]));
export const addLibraryRoot = (path: string): Promise<Root> => (inTauri ? invoke<Root>("library_add_root", { path }) : notInBrowser());
export const removeLibraryRoot = (id: number): Promise<void> => (inTauri ? invoke<void>("library_remove_root", { id }) : notInBrowser());
export const libraryFiles = (rootId: number | null): Promise<LibraryFile[]> =>
  inTauri ? invoke<LibraryFile[]>("library_files", { rootId }) : Promise.resolve([]);
export const librarySearch = (query: string): Promise<LibraryFile[]> =>
  inTauri ? invoke<LibraryFile[]>("library_search", { query }) : Promise.resolve([]);
export const libraryByHashes = (hashes: string[]): Promise<HashMatch[]> =>
  inTauri && hashes.length > 0 ? invoke<HashMatch[]>("library_by_hashes", { hashes }) : Promise.resolve([]);
export const libraryStatus = (path: string): Promise<LibraryStatus> =>
  inTauri ? invoke<LibraryStatus>("library_status", { path }) : Promise.resolve({ root: null, file: null });

/** What Rust knows about the connection (`server_status`); `useServerStatus` adds the engine's progress. */
export type ServerState = Pick<ServerStatus, "connected" | "url" | "username" | "userId" | "backup" | "paused" | "error" | "counts">;

export const serverState = (): Promise<ServerState> => (inTauri ? invoke<ServerState>("server_status") : Promise.resolve(OFFLINE_STATUS));
/** Signs in with the shared api-client (`endpoints.login`); see `src/server/session.ts`. */
export const serverConnect = (url: string, username: string, password: string): Promise<void> => signIn(url, username, password);
export const serverDisconnect = (): Promise<void> => signOut();
export const serverSetBackup = async (on: boolean): Promise<void> => {
  if (!inTauri) return notInBrowser();
  await invoke<void>("server_set_backup", { on });
  wakeBackup();
};
export const serverSetPaused = async (paused: boolean): Promise<void> => {
  if (!inTauri) return notInBrowser();
  await invoke<void>("server_set_paused", { paused });
  wakeBackup();
};
export const serverRetryFailed = async (): Promise<number> => {
  if (!inTauri) return 0;
  const n = await invoke<number>("server_retry_failed");
  wakeBackup();
  return n;
};
/** Queues one file (in the library or not) for upload, whatever the backup switch says. */
export const serverUploadFile = async (path: string): Promise<RemoteOf> => {
  if (!inTauri) return notInBrowser();
  const remote = await invoke<RemoteOf>("server_upload_file", { path });
  wakeBackup();
  return remote;
};

/**
 * What the server knows about a local file: the library's answer, then `uploadExists` (api-client)
 * for a fresh one, which is stored for the badges and the backup.
 */
export async function serverRemoteOf(path: string): Promise<RemoteOf> {
  if (!inTauri) return notInBrowser();
  const { id, ...local } = await invoke<RemoteOf & { id: number }>("backup_local_of", { path });
  const userId = signedInUser();
  if (userId === null || !local.md5 || local.state === "uploading") return local;
  const md5 = local.md5;
  const answer = await serverCall(() => endpoints.uploadExists(client, md5, userId));
  const photoId = answer.exists ? (answer.photo_id ?? "") : null;
  if (answer.exists || local.state !== "failed") {
    await invoke("backup_set_remote", { id, state: answer.exists ? "present" : "absent", photoId });
  }
  const state: RemoteState = answer.exists ? "present" : local.state === "failed" ? "failed" : "absent";
  return { ...local, state, photoId };
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

/** Library files were added, changed or removed (or their server state changed). */
export const onLibraryChanged = (handler: () => void) => on<null>("library://changed", () => handler());
export const onLibraryProgress = (handler: (p: LibraryProgress) => void) => on<LibraryProgress>("library://progress", handler);
/** The connection, backup or upload progress changed: ask `serverStatus` again. */
export const onServerStatus = (handler: () => void) => on<null>("server://status", () => handler());
