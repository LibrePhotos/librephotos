import { useCallback, useEffect, useRef, useState } from "react";
import { hub } from "../db/database";
import { createLiveStore } from "../db/live";
import { backupStats, onBackupChange } from "../server/backup";
import { onSessionChange } from "../server/session";
import {
  OFFLINE_STATUS,
  libraryDays,
  libraryFiles,
  libraryRoots,
  libraryStatus,
  onServerStatus,
  serverState,
  type LibraryFile,
  type LibraryProgress,
  type LibraryStatus,
  type Root,
  type ServerStatus,
} from "./api";
import { onLibraryProgress } from "./indexer";

/** Tables a library view reads: files, their roots, and their server state. */
const FILE_TABLES = ["local_asset", "local_album_asset", "upload_queue", "remote_photo"] as const;
const ROOT_TABLES = ["local_album", "local_album_asset"] as const;

/**
 * Runs `load` now and again after events, at most once per `ms` (events come in storms while
 * files upload). The newest answer wins.
 */
function useReloading<T>(
  load: () => Promise<T>,
  subscribe: (reload: () => void) => () => void,
  initial: T,
  ms: number,
): [T, () => void] {
  const [value, setValue] = useState<T>(initial);
  const loadRef = useRef(load);
  loadRef.current = load;
  const seq = useRef(0);
  const timer = useRef(0);
  const last = useRef(0);
  const run = useCallback(() => {
    const mine = ++seq.current;
    last.current = performance.now();
    loadRef.current().then(
      v => {
        if (mine === seq.current) setValue(v);
      },
      () => undefined,
    );
  }, []);
  const schedule = useCallback(() => {
    if (timer.current) return;
    const wait = Math.max(0, ms - (performance.now() - last.current));
    timer.current = window.setTimeout(() => {
      timer.current = 0;
      run();
    }, wait);
  }, [ms, run]);
  useEffect(() => {
    run();
    const stop = subscribe(schedule);
    return () => {
      stop();
      window.clearTimeout(timer.current);
      timer.current = 0;
    };
  }, [run, schedule, subscribe, load]);
  return [value, run];
}

/** Rust's side of the connection, the library's backup counts, and the backup engine's progress. */
async function serverStatus(): Promise<ServerStatus> {
  const state = await serverState();
  const stats = backupStats();
  return { ...state, ...stats, error: stats.error ?? state.error };
}

function onAnyServerChange(handler: () => void): () => void {
  const stops = [onServerStatus(handler), onBackupChange(handler), onSessionChange(handler), hub.watch(FILE_TABLES, handler)];
  return () => stops.forEach(stop => stop());
}

export function useServerStatus(): [ServerStatus, () => void] {
  return useReloading(serverStatus, onAnyServerChange, OFFLINE_STATUS, 250);
}

const rootsStore = createLiveStore<Root[]>([]);
const filesStore = createLiveStore<LibraryFile[] | null>(null);
const daysStore = createLiveStore<number>(0);
const statusStore = createLiveStore<LibraryStatus | null>(null);

export function useRoots(): [Root[], () => void] {
  return rootsStore.use("roots", ROOT_TABLES, libraryRoots);
}

/** Library files (of one root, or all), newest first; null until the first answer. */
export function useLibraryFiles(rootId: string | null): [LibraryFile[] | null, () => void] {
  const load = useCallback(() => libraryFiles(rootId), [rootId]);
  return filesStore.use(`files:${rootId ?? "*"}`, FILE_TABLES, load);
}

/** How many days the library (or one root) has pictures on. */
export function useLibraryDays(rootId: string | null): number {
  const load = useCallback(() => libraryDays(rootId), [rootId]);
  return daysStore.use(`days:${rootId ?? "*"}`, FILE_TABLES, load)[0];
}

export function useLibraryProgress(): LibraryProgress | null {
  const [p, setP] = useState<LibraryProgress | null>(null);
  useEffect(() => onLibraryProgress(setP), []);
  return p;
}

/** Whether the file shown in the viewer is in the library (follows library changes). */
export function useLibraryStatus(path: string | null): LibraryStatus | null {
  const load = useCallback(
    () => (path ? libraryStatus(path) : Promise.resolve<LibraryStatus>({ root: null, file: null })),
    [path],
  );
  return statusStore.use(`status:${path ?? ""}`, [...FILE_TABLES, ...ROOT_TABLES], load)[0];
}
