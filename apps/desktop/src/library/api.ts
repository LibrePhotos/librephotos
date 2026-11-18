/**
 * The library and server side of CONTRACT.md ("Library", "Server"). Every call into Rust for the
 * library view goes through here; outside Tauri the functions answer as an empty library with no
 * server, so the UI still renders in a plain browser.
 */
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { inTauri, type FileEntry } from "../ipc";

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

export const serverStatus = (): Promise<ServerStatus> => (inTauri ? invoke<ServerStatus>("server_status") : Promise.resolve(OFFLINE_STATUS));
export const serverConnect = (url: string, username: string, password: string): Promise<ServerStatus> =>
  inTauri ? invoke<ServerStatus>("server_connect", { url, username, password }) : notInBrowser();
export const serverDisconnect = (): Promise<void> => (inTauri ? invoke<void>("server_disconnect") : Promise.resolve());
export const serverSetBackup = (on: boolean): Promise<void> => (inTauri ? invoke<void>("server_set_backup", { on }) : notInBrowser());
export const serverSetPaused = (paused: boolean): Promise<void> =>
  inTauri ? invoke<void>("server_set_paused", { paused }) : notInBrowser();
export const serverRetryFailed = (): Promise<number> => (inTauri ? invoke<number>("server_retry_failed") : Promise.resolve(0));
export const serverUploadFile = (path: string): Promise<RemoteOf> => (inTauri ? invoke<RemoteOf>("server_upload_file", { path }) : notInBrowser());
export const serverRemoteOf = (path: string): Promise<RemoteOf> => (inTauri ? invoke<RemoteOf>("server_remote_of", { path }) : notInBrowser());

/** An authenticated JSON request to `/api/...` of the connected server, sent by Rust. */
export function serverFetch(path: string, method = "GET", body?: unknown): Promise<unknown> {
  return inTauri ? invoke<unknown>("server_fetch", { method, path, body: body ?? null }) : notInBrowser();
}

/** A server thumbnail through the signed-in session (`lpview` `/remote`, cached on disk). */
export function remoteThumbUrl(imageHash: string, kind: "square" | "big" = "square"): string {
  const base = navigator.userAgent.includes("Windows") ? "http://lpview.localhost" : "lpview://localhost";
  return `${base}/remote?kind=${kind}&hash=${encodeURIComponent(imageHash)}`;
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
