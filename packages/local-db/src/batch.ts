/**
 * Atomic writes: a list of statements run as ONE executor batch (one
 * transaction). This is the package's replacement for interactive
 * transactions; see executor.ts for why there are none.
 */
import type { SQL } from "drizzle-orm";
import type { AppDatabase } from "./database";

/** Run `statements` in order, all-or-nothing. A no-op for an empty list. */
export async function runBatch(db: AppDatabase, statements: readonly SQL[]): Promise<void> {
  const [head, ...tail] = statements;
  if (head === undefined) return;
  await db.batch([db.run(head), ...tail.map((statement) => db.run(statement))]);
}
