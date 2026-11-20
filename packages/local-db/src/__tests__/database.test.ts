import Database from "better-sqlite3";
import { sql } from "drizzle-orm";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createBetterSqliteExecutor } from "../better-sqlite3";
import { trackChanges, writtenTables } from "../change-hub";
import { createDatabase, runWrite } from "../database";
import { createSerialQueue } from "../executor";
import { MIGRATIONS, MIGRATIONS_TABLE, runMigrations } from "../migrate";
import { localAsset } from "../schema";
import { buildMigrations, render } from "../../scripts/build-migrations.mjs";
import { createTestDb } from "../testing";
import { remotePhoto, seedRemotePhotos } from "../fixtures";

const here = dirname(fileURLToPath(import.meta.url));

describe("AppDatabase over an executor", () => {
  it("returns raw SQL rows as objects and builder rows mapped onto fields", async () => {
    const t = createTestDb();
    try {
      await t.db.run(sql`INSERT INTO local_asset (id, name, width) VALUES ('a', 'one.jpg', 10), ('b', 'two.jpg', 20)`);
      expect(await t.db.all<{ id: string; w: number }>(sql`SELECT id, width AS w FROM local_asset ORDER BY id`)).toEqual([
        { id: "a", w: 10 },
        { id: "b", w: 20 },
      ]);
      expect(await t.db.get<{ id: string }>(sql`SELECT id FROM local_asset WHERE id = 'b'`)).toEqual({ id: "b" });
      expect(await t.db.get(sql`SELECT id FROM local_asset WHERE id = 'zzz'`)).toBeUndefined();
      expect(await t.db.values(sql`SELECT id, width FROM local_asset ORDER BY id`)).toEqual([
        ["a", 10],
        ["b", 20],
      ]);
      // The query builder still works (positional rows, its own mapping).
      const built = await t.db.select({ id: localAsset.id, name: localAsset.name }).from(localAsset).orderBy(localAsset.id);
      expect(built).toEqual([
        { id: "a", name: "one.jpg" },
        { id: "b", name: "two.jpg" },
      ]);
    } finally {
      t.close();
    }
  });

  it("reports changes of a write", async () => {
    const t = createTestDb();
    try {
      await seedRemotePhotos(t.db, [remotePhoto({ id: "a" }), remotePhoto({ id: "b" })]);
      expect((await runWrite(t.db, sql`UPDATE remote_photo SET rating = 5`)).changes).toBe(2);
    } finally {
      t.close();
    }
  });

  it("runs a batch atomically and maps every item", async () => {
    const t = createTestDb();
    try {
      const [, rows, one] = await t.db.batch([
        t.db.run(sql`INSERT INTO app_meta (key, value) VALUES ('k', 'v')`),
        t.db.all<{ key: string }>(sql`SELECT key FROM app_meta`),
        t.db.get<{ value: string }>(sql`SELECT value FROM app_meta WHERE key = 'k'`),
      ]);
      expect(rows).toEqual([{ key: "k" }]);
      expect(one).toEqual({ value: "v" });

      await expect(
        t.db.batch([
          t.db.run(sql`INSERT INTO app_meta (key, value) VALUES ('k2', 'v2')`),
          t.db.run(sql`INSERT INTO no_such_table (x) VALUES (1)`),
        ])
      ).rejects.toThrow();
      // Nothing of the failed batch is left.
      expect(await t.db.get(sql`SELECT key FROM app_meta WHERE key = 'k2'`)).toBeUndefined();
    } finally {
      t.close();
    }
  });

  it("refuses interactive transactions", async () => {
    const t = createTestDb();
    try {
      await expect(t.db.transaction(async () => undefined)).rejects.toThrow(/db\.batch/);
    } finally {
      t.close();
    }
  });

  it("binds booleans as 0/1", async () => {
    const t = createTestDb();
    try {
      expect(await t.db.get<{ v: number }>(sql`SELECT ${true} AS v`)).toEqual({ v: 1 });
    } finally {
      t.close();
    }
  });
});

describe("serial queue", () => {
  it("runs tasks one at a time in call order, a failure not stopping the rest", async () => {
    const serial = createSerialQueue();
    const log: string[] = [];
    const slow = serial(async () => {
      log.push("a:start");
      await new Promise((r) => setTimeout(r, 5));
      log.push("a:end");
    });
    const failing = serial(() => Promise.reject(new Error("boom")));
    const fast = serial(async () => {
      log.push("c");
    });
    await slow;
    await expect(failing).rejects.toThrow("boom");
    await fast;
    expect(log).toEqual(["a:start", "a:end", "c"]);
  });
});

describe("migrations", () => {
  it("migrations.json is what the SQL files say", () => {
    const onDisk = readFileSync(join(here, "..", "..", "migrations", "migrations.json"), "utf8").replace(/\r\n/g, "\n");
    expect(onDisk).toBe(render(buildMigrations()));
  });

  it("applies every migration once and records it", async () => {
    const sqlite = new Database(":memory:");
    try {
      const executor = createBetterSqliteExecutor(sqlite);
      const first = await runMigrations(executor, { now: 42 });
      expect(first).toEqual({ applied: MIGRATIONS.map((m) => m.tag), wiped: false });
      expect(sqlite.prepare(`SELECT tag, applied_at FROM ${MIGRATIONS_TABLE} ORDER BY tag`).all()).toEqual(
        MIGRATIONS.map((m) => ({ tag: m.tag, applied_at: 42 }))
      );
      expect(await runMigrations(executor)).toEqual({ applied: [], wiped: false });
    } finally {
      sqlite.close();
    }
  });

  it("wipes and rebuilds a database it cannot migrate, keeping outbox and upload_queue", async () => {
    const sqlite = new Database(":memory:");
    try {
      // A database from the old, squashed migrations: tables exist, no bookkeeping.
      sqlite.exec(`CREATE TABLE remote_photo (id TEXT PRIMARY KEY, stale INTEGER)`);
      sqlite.exec(`INSERT INTO remote_photo VALUES ('old', 1)`);
      sqlite.exec(`CREATE TABLE outbox (id INTEGER PRIMARY KEY AUTOINCREMENT, created_at INTEGER NOT NULL,
                   kind TEXT NOT NULL, payload TEXT, state TEXT NOT NULL DEFAULT 'pending', gone_column TEXT)`);
      sqlite.exec(`INSERT INTO outbox (created_at, kind, payload, gone_column) VALUES (1, 'favorite', '{}', 'x')`);
      sqlite.exec(`CREATE TABLE __drizzle_migrations (id INTEGER, hash TEXT)`);
      const executor = createBetterSqliteExecutor(sqlite);
      let reported: unknown = null;
      const result = await runMigrations(executor, { onWipe: (e) => (reported = e) });
      expect(result.wiped).toBe(true);
      expect(reported).toBeInstanceOf(Error);
      expect(sqlite.prepare("SELECT COUNT(*) AS c FROM remote_photo").get()).toEqual({ c: 0 });
      expect(sqlite.prepare("SELECT kind, payload, attempts FROM outbox").all()).toEqual([
        { kind: "favorite", payload: "{}", attempts: 0 },
      ]);
      expect(sqlite.prepare("SELECT name FROM sqlite_master WHERE name = '__drizzle_migrations'").get()).toBeUndefined();
      // The rebuilt schema is complete, the search index included, and migrates as current.
      expect(sqlite.prepare("SELECT COUNT(*) AS c FROM local_asset_fts").get()).toEqual({ c: 0 });
      expect(await runMigrations(executor)).toEqual({ applied: [], wiped: false });
    } finally {
      sqlite.close();
    }
  });
});

describe("change tracking", () => {
  it("names the tables a statement writes", () => {
    expect(writtenTables("SELECT * FROM remote_photo")).toEqual([]);
    expect(writtenTables("INSERT INTO `remote_photo` (id) VALUES (?)")).toEqual(["remote_photo"]);
    expect(writtenTables("insert or ignore into user_album_photo (a) values (1)")).toEqual(["user_album_photo"]);
    expect(writtenTables("UPDATE upload_queue SET state = 'x' WHERE asset_id = (SELECT id FROM local_asset)")).toEqual([
      "upload_queue",
    ]);
    expect(writtenTables("DELETE FROM sync_log WHERE id <= 3")).toEqual(["sync_log"]);
    expect(writtenTables("CREATE TABLE x (a)")).toBeNull();
  });

  it("reports each written table once per statement, batches included", async () => {
    const sqlite = new Database(":memory:");
    try {
      sqlite.exec("CREATE TABLE a (x); CREATE TABLE b (x)");
      const tracked = trackChanges(createBetterSqliteExecutor(sqlite));
      const seen: (string | undefined)[] = [];
      const stop = tracked.subscribe((table) => seen.push(table));
      const db = createDatabase(tracked.executor);
      await db.run(sql`INSERT INTO a VALUES (1), (2), (3)`);
      await db.all(sql`SELECT * FROM a`);
      await db.batch([db.run(sql`INSERT INTO b VALUES (1)`), db.run(sql`DELETE FROM a`)]);
      stop();
      await db.run(sql`INSERT INTO a VALUES (4)`);
      expect(seen).toEqual(["a", "b", "a"]);
    } finally {
      sqlite.close();
    }
  });
});
