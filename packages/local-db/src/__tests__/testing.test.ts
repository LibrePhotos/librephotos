import { describe, expect, it } from "vitest";
import { createTestDb } from "../testing";

describe("createTestDb after close", () => {
  it("answers a late read from a still-mounted screen with no rows instead of failing", async () => {
    const t = createTestDb();
    t.close();

    await expect(t.executor.exec("SELECT 1 AS one", [], "all")).resolves.toEqual({ rows: [], columns: [] });
    await expect(t.executor.exec("SELECT 1 AS one", [], "get")).resolves.toEqual({ rows: undefined, columns: [] });
    await expect(
      t.executor.batch([
        { sql: "SELECT 1", params: [], method: "all" },
        { sql: "SELECT 2", params: [], method: "get" },
      ])
    ).resolves.toEqual([
      { rows: [], columns: [] },
      { rows: undefined, columns: [] },
    ]);
  });

  it("still reads normally while open", async () => {
    const t = createTestDb();
    try {
      const result = await t.executor.exec("SELECT 1 AS one", [], "all");
      expect(result.rows).toEqual([[1]]);
      expect(result.columns).toEqual(["one"]);
    } finally {
      t.close();
    }
  });
});
