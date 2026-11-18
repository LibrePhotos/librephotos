import { useCallback, useEffect, useRef, useState } from "react";
import {
  OFFLINE_STATUS,
  libraryFiles,
  libraryRoots,
  libraryStatus,
  onLibraryChanged,
  onLibraryProgress,
  onServerStatus,
  serverState,
  type LibraryFile,
  type LibraryProgress,
  type LibraryStatus,
  type Root,
  type ServerStatus,
} from "./api";
import { backupStats, onBackupChange } from "../server/backup";
import { onSessionChange } from "../server/session";

/**
 * Runs `load` now and again after events, at most once per `ms` (events come in storms while a
 * folder is indexed or uploaded). The newest answer wins.
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

/** Rust's side of the connection (settings, library counts) plus the backup engine's progress. */
async function serverStatus(): Promise<ServerStatus> {
  const state = await serverState();
  const stats = backupStats();
  return { ...state, ...stats, error: stats.error ?? state.error };
}

function onAnyServerChange(handler: () => void): () => void {
  const stops = [onServerStatus(handler), onBackupChange(handler), onSessionChange(handler)];
  return () => stops.forEach(stop => stop());
}

export function useServerStatus(): [ServerStatus, () => void] {
  return useReloading(serverStatus, onAnyServerChange, OFFLINE_STATUS, 250);
}

export function useRoots(): [Root[], () => void] {
  return useReloading(libraryRoots, onLibraryChanged, [], 800);
}

/** Library files (of one root, or all), newest first; null until the first answer. */
export function useLibraryFiles(rootId: number | null): [LibraryFile[] | null, () => void] {
  const load = useCallback(() => libraryFiles(rootId), [rootId]);
  return useReloading<LibraryFile[] | null>(load, onLibraryChanged, null, 700);
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
  const [s] = useReloading<LibraryStatus | null>(load, onLibraryChanged, null, 1000);
  return s;
}
