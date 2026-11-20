/**
 * The desktop's file seams (CONTRACT.md "File seams"): what Rust knows about files on disk, as
 * data for the shared package's writers, which store it. Nothing here writes the database.
 */
import { Channel, invoke, isTauri } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { FileKind } from "../ipc";

export type FsEntry = { path: string; folder: string; name: string; size: number; mtimeMs: number; kind: FileKind };
export type WalkBatch = { files: FsEntry[]; done: boolean };
export type FileMeta = {
  path: string;
  format: string;
  width: number | null;
  height: number | null;
  takenAt: string | null;
  /** `takenAt` as local wall-clock ms (read with UTC getters). */
  takenMs: number | null;
  cameraMake: string | null;
  cameraModel: string | null;
  camera: string | null;
  lens: string | null;
  lat: number | null;
  lon: number | null;
  rating: number | null;
  caption: string | null;
  keywords: string[];
};
export type FsRenamed = { from: string; to: string; dir: boolean };
export type FsChanges = { root: string; created: FsEntry[]; modified: FsEntry[]; removed: string[]; renamed: FsRenamed[] };

function needTauri(): void {
  if (!isTauri()) throw new Error("file access needs the desktop app");
}

/**
 * Walks `root` (hidden folders skipped), handing over batches of up to 500 files as they are
 * found. Resolves with the number of files once the last batch was handed over.
 */
export async function walkRoot(root: string, onBatch: (files: FsEntry[]) => void | Promise<void>): Promise<number> {
  needTauri();
  let pending = Promise.resolve();
  let finished: () => void = () => undefined;
  const lastBatch = new Promise<void>(resolve => (finished = resolve));
  const channel = new Channel<WalkBatch>(batch => {
    // Batches are handled one after the other, in order.
    pending = pending.then(async () => {
      if (batch.files.length > 0) await onBatch(batch.files);
      if (batch.done) finished();
    });
  });
  const total = await invoke<number>("fs_walk", { root, onBatch: channel });
  await lastBatch;
  await pending;
  return total;
}

/** Starts (or restarts) the watcher of `root`; resolves with the root as `fs://changed` names it. */
export const watchRoot = (root: string): Promise<string> => (needTauri(), invoke<string>("fs_watch", { root }));
export const unwatchRoot = (root: string): Promise<boolean> => (needTauri(), invoke<boolean>("fs_unwatch", { root }));

/** Headers of up to 4096 files, read on 4 threads; null for a file that cannot be read. */
export const readMetadata = (paths: string[]): Promise<(FileMeta | null)[]> =>
  paths.length === 0 ? Promise.resolve([]) : (needTauri(), invoke<(FileMeta | null)[]>("fs_read_metadata", { paths }));

/** What a walk would say about these paths now; null for missing files, folders and other kinds. */
export const statPaths = (paths: string[]): Promise<(FsEntry | null)[]> =>
  paths.length === 0 ? Promise.resolve([]) : (needTauri(), invoke<(FsEntry | null)[]>("fs_stat", { paths }));

/** The file's MD5, lower-case hex (streamed in Rust). */
export const md5File = (path: string): Promise<string> => (needTauri(), invoke<string>("fs_md5", { path }));

/** One debounced batch of file changes under a watched root. */
export function onFsChanged(handler: (changes: FsChanges) => void): () => void {
  if (!isTauri()) return () => undefined;
  let unlisten: UnlistenFn | null = null;
  let disposed = false;
  void listen<FsChanges>("fs://changed", e => handler(e.payload)).then(fn => {
    if (disposed) fn();
    else unlisten = fn;
  });
  return () => {
    disposed = true;
    unlisten?.();
  };
}
