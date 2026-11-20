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
  void invoke<{ backup: boolean }>("server_status").then(s => setRootsBackup(s.backup), () => undefined);
}

declare global {
  interface Window {
    __lpDbBench?: (opts?: { walkRoot?: string }) => Promise<Record<string, unknown>>;
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
