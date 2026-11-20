import { createChangeHub, createDatabase, type AppDatabase, type ChangeHub } from "@librephotos/local-db";
import { executor, onDbChanged } from "./executor";

let lastInteraction = 0;

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
