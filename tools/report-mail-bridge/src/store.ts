import { Database } from "bun:sqlite";

// Everything the bridge keeps: hourly counters for the rate limits, the
// hashes of the reports it forwarded (no report content, no addresses), and
// the inbox: mail without a valid report, kept for the maintainers to read.

export const HOUR = 60 * 60 * 1000;
export const DAY = 24 * HOUR;
// A report's hash is kept this long after it was last received; LibrePhotos
// itself keeps a report no longer (store.py, MAX_AGE).
export const REPORT_RETENTION = 30 * DAY;
export const INBOX_RETENTION = 30 * DAY;
const INBOX_LIMITS = { maxMessages: 500, maxBytes: 500 * 1024 * 1024 };
const SNIPPET = 200;

export type InboxAttachment = { name: string; type: string; size: number };
export type InboxEntry = {
  /** The envelope sender (MAIL FROM). */
  sender: string;
  /** The From header. */
  from: string;
  subject: string;
  text: string;
  headers: Record<string, string>;
  attachments: InboxAttachment[];
  raw: Uint8Array;
};
export type InboxSummary = {
  id: number;
  received: string;
  from: string;
  subject: string;
  snippet: string;
  attachments: string[];
};
export type InboxMessage = Omit<InboxEntry, "raw"> & { id: number; received: string };

type InboxRow = {
  id: number;
  received: number;
  sender: string;
  from_header: string;
  subject: string;
  text: string;
  headers: string;
  attachments: string;
};

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
  CREATE TABLE IF NOT EXISTS inbox (
    id INTEGER PRIMARY KEY AUTOINCREMENT, received INTEGER NOT NULL,
    sender TEXT NOT NULL, from_header TEXT NOT NULL, subject TEXT NOT NULL,
    text TEXT NOT NULL, headers TEXT NOT NULL, attachments TEXT NOT NULL,
    raw BLOB NOT NULL, size INTEGER NOT NULL
  );
`;

function attachmentsOf(row: InboxRow): InboxAttachment[] {
  return JSON.parse(row.attachments);
}

function toMessage(row: InboxRow): InboxMessage {
  return {
    id: row.id,
    received: new Date(row.received).toISOString(),
    sender: row.sender,
    from: row.from_header,
    subject: row.subject,
    text: row.text,
    headers: JSON.parse(row.headers),
    attachments: attachmentsOf(row),
  };
}

export class Store {
  private readonly db: Database;
  private readonly salt: string;

  constructor(
    path: string,
    private readonly now: () => number = Date.now,
    private readonly inboxLimits = INBOX_LIMITS,
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

  /** How many `take`s for `name` were counted this hour. */
  count(name: string): number {
    const row = this.db
      .query<{ count: number }, [string, number]>("SELECT count FROM counters WHERE name = ? AND hour = ?")
      .get(name, this.hour());
    return row?.count ?? 0;
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

  /** Drop counters of past hours, hashes past `REPORT_RETENTION` and inbox mail past `INBOX_RETENTION`. */
  cleanup(): void {
    this.db.query("DELETE FROM counters WHERE hour < ?").run(this.hour());
    this.db.query("DELETE FROM reports WHERE last_seen < ?").run(this.now() - REPORT_RETENTION);
    this.db.query("DELETE FROM inbox WHERE received < ?").run(this.now() - INBOX_RETENTION);
  }

  /** Keep a mail in the inbox; the oldest go once there are too many or they are too big. */
  keep(entry: InboxEntry): number {
    const result = this.db
      .query(
        `INSERT INTO inbox (received, sender, from_header, subject, text, headers, attachments, raw, size)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        this.now(),
        entry.sender,
        entry.from,
        entry.subject,
        entry.text,
        JSON.stringify(entry.headers),
        JSON.stringify(entry.attachments),
        entry.raw,
        entry.raw.length + entry.text.length,
      );
    this.evict();
    return Number(result.lastInsertRowid);
  }

  private evict(): void {
    const { maxMessages, maxBytes } = this.inboxLimits;
    this.db.query("DELETE FROM inbox WHERE id NOT IN (SELECT id FROM inbox ORDER BY id DESC LIMIT ?)").run(maxMessages);
    this.db
      .query(
        `DELETE FROM inbox WHERE id IN (
           SELECT id FROM (SELECT id, SUM(size) OVER (ORDER BY id DESC) AS total FROM inbox) WHERE total > ?
         )`,
      )
      .run(maxBytes);
  }

  inboxList(): InboxSummary[] {
    return this.db
      .query<InboxRow, []>(
        `SELECT id, received, sender, from_header, subject, substr(text, 1, ${SNIPPET}) AS text, headers, attachments
         FROM inbox ORDER BY id DESC`,
      )
      .all()
      .map((row) => ({
        id: row.id,
        received: new Date(row.received).toISOString(),
        from: row.from_header,
        subject: row.subject,
        snippet: row.text,
        attachments: attachmentsOf(row).map((attachment) => attachment.name),
      }));
  }

  inboxGet(id: number): InboxMessage | null {
    const row = this.db
      .query<InboxRow, [number]>(
        "SELECT id, received, sender, from_header, subject, text, headers, attachments FROM inbox WHERE id = ?",
      )
      .get(id);
    return row ? toMessage(row) : null;
  }

  inboxRaw(id: number): Uint8Array | null {
    const row = this.db.query<{ raw: Uint8Array }, [number]>("SELECT raw FROM inbox WHERE id = ?").get(id);
    return row ? row.raw : null;
  }

  inboxDelete(id: number): boolean {
    return this.db.query("DELETE FROM inbox WHERE id = ?").run(id).changes === 1;
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
