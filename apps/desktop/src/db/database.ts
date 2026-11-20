/**
 * The app's one database: `packages/local-db` over the Rust engine (./executor), and the package's
 * change hub fed by Rust's coalesced `db://changed` events. Rust applied the migrations before the
 * window existed, so queries can run at once.
 */
import { createChangeHub, createDatabase, type AppDatabase, type ChangeHub } from "@librephotos/local-db";
import { executor, onDbChanged } from "./executor";

let lastInteraction = 0;

/** A scroll or drag is under way: live queries hold their re-reads a moment (the hub's `defer`). */
export function markInteraction(): void {
  lastInteraction = performance.now();
}

export const db: AppDatabase = createDatabase(executor);

export const hub: ChangeHub = createChangeHub({
  subscribe: listener =>
    onDbChanged(tables => {
      for (const table of tables) listener(table);
    }),
  defer: () => performance.now() - lastInteraction < 200,
});
