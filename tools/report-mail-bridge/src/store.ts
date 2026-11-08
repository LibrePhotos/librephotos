import { Database } from "bun:sqlite";

// Everything the bridge keeps: hourly counters for the rate limits and the
// hashes of the reports it forwarded. No report content, no addresses.

export const HOUR = 60 * 60 * 1000;
export const DAY = 24 * HOUR;
// A report's hash is kept this long after it was last received; LibrePhotos
// itself keeps a report no longer (store.py, MAX_AGE).
export const REPORT_RETENTION = 30 * DAY;

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS counters (
    name TEXT NOT NULL, hour INTEGER NOT NULL, count INTEGER NOT NULL,
    PRIMARY KEY (name, hour)
  ) WITHOUT ROWID;
  CREATE TABLE IF NOT EXISTS reports (
    hash TEXT PRIMARY KEY, first_seen INTEGER NOT NULL, last_seen INTEGER NOT NULL
  ) WITHOUT ROWID;
  CREATE TABLE IF NOT EXISTS settings (
    name TEXT PRIMARY KEY, value TEXT NOT NULL
  ) WITHOUT ROWID;
`;

export class Store {
  private readonly db: Database;
  private readonly salt: string;

  constructor(
    path: string,
    private readonly now: () => number = Date.now,
  ) {
    this.db = new Database(path, { create: true, strict: true });
    this.db.run("PRAGMA journal_mode = WAL");
    this.db.run("PRAGMA busy_timeout = 5000");
    this.db.run(SCHEMA);
    this.salt = this.loadSalt();
  }

  private loadSalt(): string {
    const fresh = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("hex");
    this.db.query("INSERT OR IGNORE INTO settings (name, value) VALUES ('salt', ?)").run(fresh);
    const row = this.db.query<{ value: string }, []>("SELECT value FROM settings WHERE name = 'salt'").get();
    return row?.value ?? fresh;
  }

  private hour(): number {
    return Math.floor(this.now() / HOUR);
  }

  /** Count one more for `name` this hour; false once `limit` is reached (that one is not counted). */
  take(name: string, limit: number): boolean {
    const result = this.db
      .query(
        `INSERT INTO counters (name, hour, count) VALUES (?, ?, 1)
         ON CONFLICT (name, hour) DO UPDATE SET count = count + 1 WHERE count < ?`,
      )
      .run(name, this.hour(), limit);
    return result.changes === 1;
  }

  /** A counter name for a client: a keyed hash, so the address itself is never stored. */
  clientKey(address: string): string {
    return new Bun.CryptoHasher("sha256", this.salt).update(address).digest("hex").slice(0, 32);
  }

  seen(hash: string): boolean {
    return this.db.query("SELECT 1 FROM reports WHERE hash = ?").get(hash) !== null;
  }

  /** Note that the report with `hash` was received now. */
  remember(hash: string): void {
    const now = this.now();
    this.db
      .query(
        `INSERT INTO reports (hash, first_seen, last_seen) VALUES (?, ?, ?)
         ON CONFLICT (hash) DO UPDATE SET last_seen = excluded.last_seen`,
      )
      .run(hash, now, now);
  }

  /** Drop counters of past hours and hashes past `REPORT_RETENTION`. */
  cleanup(): void {
    this.db.query("DELETE FROM counters WHERE hour < ?").run(this.hour());
    this.db.query("DELETE FROM reports WHERE last_seen < ?").run(this.now() - REPORT_RETENTION);
  }

  /** For tests: the column names of `table`. */
  columns(table: string): string[] {
    return this.db
      .query<{ name: string }, [string]>("SELECT name FROM pragma_table_info(?)")
      .all(table)
      .map((row) => row.name);
  }

  /** For tests: how many counter rows exist. */
  counterRows(): number {
    return this.db.query<{ n: number }, []>("SELECT COUNT(*) AS n FROM counters").get()?.n ?? 0;
  }

  close(): void {
    this.db.close();
  }
}
