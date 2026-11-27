import { readNewBuildReloadTime, writeNewBuildReloadTime } from "../util/storage";

const STALE_CHUNK_MESSAGES = [
  "Failed to fetch dynamically imported module",
  "error loading dynamically imported module",
  "Importing a module script failed",
  "Unable to preload CSS for",
];

export const NEW_BUILD_RELOAD_GUARD_MS = 60_000;

let reloading = false;

function isStaleChunkError(error: unknown): boolean {
  return error instanceof Error && STALE_CHUNK_MESSAGES.some(message => error.message.startsWith(message));
}

function reloadOnce(): boolean {
  const now = Date.now();
  const lastReload = readNewBuildReloadTime();
  if (lastReload !== undefined && Math.abs(now - lastReload) < NEW_BUILD_RELOAD_GUARD_MS) return false;
  if (!writeNewBuildReloadTime(now)) return false;
  reloading = true;
  window.location.reload();
  return true;
}

export function reloadsForNewBuild(error: unknown): boolean {
  return reloading || (isStaleChunkError(error) && reloadOnce());
}

export function installNewBuildReload(): () => void {
  const onPreloadError = (event: VitePreloadErrorEvent) => {
    reloadsForNewBuild(event.payload);
  };
  window.addEventListener("vite:preloadError", onPreloadError);
  return () => window.removeEventListener("vite:preloadError", onPreloadError);
}
