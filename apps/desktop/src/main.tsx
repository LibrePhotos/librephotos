import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { watchStartup } from "./lib/startupMarks";
import { onBackupWork, setLibraryAccount, setRootsBackup, startLibrary } from "./library/indexer";
import { startBackup, wakeBackup } from "./server/backup";
import { startEditSync } from "./edits/serverSync";
import { loadSession, onSessionChange, serverUrl, signedInUser } from "./server/session";
import { inTauri } from "./ipc";
import { invoke } from "@tauri-apps/api/core";
import "./styles.css";
import "./ui/ui.css";

watchStartup();
startBackup();
startLibrary();
startEditSync();

/** The library hashes for the signed-in account (and rebuilds its hashes when the account changes). */
function syncAccount(): void {
  const url = serverUrl();
  const userId = signedInUser();
  void setLibraryAccount(url !== null && userId !== null ? { url, userId } : null).catch((e: unknown) =>
    console.warn("[library] account:", e),
  );
}
if (inTauri) {
  onBackupWork(wakeBackup);
  onSessionChange(syncAccount);
  void loadSession()
    .catch(() => undefined)
    .then(syncAccount);
  // The backup switch lives in Rust's settings; the roots follow it.
  void invoke<{ backup: boolean }>("server_status").then(s => setRootsBackup(s.backup), () => undefined);
}

declare global {
  interface Window {
    /** The local database's IPC micro-benchmark (`src/db/bench.ts`), for CDP runs; loaded on first use. */
    __lpDbBench?: (opts?: { walkRoot?: string }) => Promise<Record<string, unknown>>;
    /** Library and server calls for CDP test runs (`src/library/dev.ts`); loaded on first use. */
    __lpDev?: () => Promise<typeof import("./library/dev").dev>;
  }
}
window.__lpDbBench = opts => import("./db/bench").then(m => m.runDbBench(opts));
window.__lpDev = () => import("./library/dev").then(m => m.dev);

const root = document.getElementById("root");
if (!root) throw new Error("index.html has no #root");

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
