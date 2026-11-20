import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { watchStartup } from "./lib/startupMarks";
import { startBackup } from "./server/backup";
import "./styles.css";
import "./ui/ui.css";

watchStartup();
startBackup();

declare global {
  interface Window {
    /** The local database's IPC micro-benchmark (`src/db/bench.ts`), for CDP runs; loaded on first use. */
    __lpDbBench?: (opts?: { walkRoot?: string }) => Promise<Record<string, unknown>>;
  }
}
window.__lpDbBench = opts => import("./db/bench").then(m => m.runDbBench(opts));

const root = document.getElementById("root");
if (!root) throw new Error("index.html has no #root");

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
