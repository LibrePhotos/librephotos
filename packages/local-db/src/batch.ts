import type { SQL } from "drizzle-orm";
import type { AppDatabase } from "./database";

export async function runBatch(db: AppDatabase, statements: readonly SQL[]): Promise<void> {
  const [head, ...tail] = statements;
  if (head === undefined) return;
  await db.batch([db.run(head), ...tail.map((statement) => db.run(statement))]);
}
