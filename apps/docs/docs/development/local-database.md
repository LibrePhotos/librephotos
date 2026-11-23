---
title: "On-device database"
description: "packages/local-db, the SQLite database the mobile app (and next the desktop app) keeps on the device: the executor contract, batches instead of transactions, migrations, the change hub, live queries, and how to add a query or a column."
sidebar_position: 5
---

The mobile app keeps a SQLite database on the phone: a mirror of the server library, the camera roll, the sync and upload queues and the offline outbox. The desktop app keeps the same database for the folders the user added. Both use one package for it, [`packages/local-db`](https://github.com/LibrePhotos/librephotos/tree/dev/packages/local-db) (`@librephotos/local-db`), so the schema, the SQL and the change handling are written once and tested once in Node.

The package owns:

| Part | Where |
| --- | --- |
| Drizzle schema and row types | `src/schema.ts`, `src/types.ts` |
| Migrations | `migrations/*.sql`, `migrations/migrations.json`, `src/migrate.ts` |
| Queries | `src/queries/` (timeline, albums, people, search, memories, counts, the desktop folder library, the upload queue, ...) |
| Writers for the server mirror | `src/writers.ts` |
| Atomic writes | `src/batch.ts` (`runBatch`), `runWrite` in `src/database.ts` |
| The change hub | `src/change-hub.ts` |
| Logout and reset | `src/reset.ts` (`clearMirror`, `clearEntity`, `wipeLocalData`) |
| Node adapter and the test database | `@librephotos/local-db/better-sqlite3`, `@librephotos/local-db/testing` |

The platform adapters are separate entry points, so importing the package never pulls in a native module by accident. Like `packages/api-client`, the package is TypeScript source that Metro, jest, vitest and Vite compile directly; there is no build step.

Platform code stays in the apps. An app provides exactly one thing: an **executor**.

## The executor contract

`SqlExecutor` (`src/executor.ts`) is the one seam between the shared code and a platform's SQLite. Every runtime implements it and nothing else: expo-sqlite on the phone, rusqlite behind Tauri commands on the desktop, better-sqlite3 in Node tests and tools. Keep it this small: every method is one more thing the Rust side has to implement and keep in step.

```ts
interface SqlExecutor {
  exec(sql: string, params: SqlValue[], method: "run" | "all" | "get" | "values"): Promise<SqlResult>;
  batch(statements: { sql: string; params: SqlValue[]; method: SqlMethod }[]): Promise<SqlResult[]>;
}
```

- `exec` runs **one** statement. Parameters are positional (`?`) and already normalised to a `SqlValue` (string, number, bigint, `Uint8Array` or null; booleans arrive as 0 or 1, dates as numbers).
- `method` says what the caller wants back, in Drizzle sqlite-proxy's shapes:
  - `"run"`: `{ rows: [] }`, plus `changes` and `lastInsertRowId` when the driver reports them;
  - `"all"` and `"values"`: `{ rows: Row[] }`, every result row;
  - `"get"`: `{ rows: Row | undefined }`, the first row. The statement still steps to the end, because an `INSERT ... RETURNING` writes a row for every step.
- A row is a **positional array**, never an object. Positional rows keep duplicate column names apart and are what Drizzle's query builder maps.
- `columns`, the statement's column names in result order, is **required for `"all"` and `"get"`**. Every query in the package is raw SQL whose rows are read by name, and only the engine knows the names (`sqlite3_column_name`, rusqlite's `Statement::column_names()`).
- A statement with `RETURNING` is sent as `"all"` or `"get"`: it writes and returns rows.
- `batch` runs its statements in order inside **one transaction** and returns one result per statement. It is all or nothing: if a statement fails, everything the batch did is rolled back and the promise rejects. No other `exec` or `batch` call may run on the connection in between.

`createSerialQueue()` runs async tasks one at a time, in call order; a failed task does not stop the queue. An executor over a single async connection (the phone's) wraps every `exec` and `batch` in it, which is what keeps one caller's `BEGIN ... COMMIT` from interleaving with another caller's statements. On the desktop a `Mutex<Connection>` does the same.

| Runtime | Executor | Where |
| --- | --- | --- |
| Node (tests, tools, scripts) | `createBetterSqliteExecutor(db)` | `@librephotos/local-db/better-sqlite3` |
| Phone | `createExpoExecutor(sqlite)` | `apps/mobile/src/db/client.ts` |
| Desktop | an executor over the Tauri commands `db_exec` and `db_batch` (rusqlite) | the desktop app |

The better-sqlite3 adapter takes an open `Database` instead of opening one, so the package never loads the native addon itself (better-sqlite3 is an optional peer dependency). Its connection is synchronous, so every call is atomic and isolated on its own, and a batch is one better-sqlite3 transaction. It caches prepared statements by SQL text in a small LRU, because a seed batch repeats one `INSERT` a thousand times.

## Async everywhere, and batches instead of transactions

```ts
import { createDatabase, runMigrations } from "@librephotos/local-db";

await runMigrations(executor);
const db = createDatabase(executor);
const page = await timelinePage(db, { limit: 120 });
```

`createDatabase` is cheap (no I/O) and returns an `AppDatabase`: Drizzle's async SQLite database (`drizzle-orm/sqlite-proxy`) over the executor. Every query module and writer takes one. Two kinds of reads go through it and want different row shapes:

- raw SQL (`` db.all<Row>(sql`...`) ``, `db.get<Row>(...)`), which is how every query in the package is written, wants objects keyed by column name;
- Drizzle's query builder (`db.select().from(t)`) maps positional rows onto its fields itself.

sqlite-proxy hands both to the same callback and cannot tell them apart, so the callback passes the executor's whole result through and a prepared query that knows whether it has builder fields decodes it. The executor always answers positionally; objects are built once, in `src/database.ts` (`rowsToObjects`, a later duplicate column name wins). Raw items inside `db.batch([...])` are decoded the same way.

Every call is a promise. Both the package and the mobile app lint with `no-floating-promises`, `no-misused-promises` and `await-thenable`: a forgotten `await` is a write that may not have happened yet, or a promise tested for truthiness.

There is deliberately **no "begin a transaction and hand it back"** call. An async executor shared by concurrent callers cannot hold a transaction open while other callers keep issuing statements. So:

- **Atomic writes are one batch**: `runBatch(db, statements)` or `db.batch([...])`. `db.transaction()` rejects, and a lint rule (`no-restricted-syntax`) bans calling it in the package and the app. better-sqlite3's own synchronous `sqlite.transaction` stays allowed in Node code.
- **A read-then-write that must be atomic is one statement**: `UPDATE ... WHERE id = (SELECT ...) RETURNING ...`. `claimNextJob`, `claimNextUpload` and `claimExistenceChecks` pick a row and move it to `running`, `uploading` or `checking` in the statement that selects it, so a claim either wins outright or yields nothing, and two workers can never be handed the same row even though they interleave between statements.
- **A write that reports what it changed** uses `runWrite(db, query)` or `RETURNING`, never a follow-up `SELECT changes()`: on a shared async connection another caller's statement can run in between, and the second query would read its count.
- **A batch cannot read between its statements**, so every statement computes what it needs in SQL. The mobile app's offline actions (`apps/mobile/src/mutations/actions.ts`) recount with a subquery and pick a temporary album id as `MIN(id) - 1`. That id is chosen before the batch, so a concurrent create can pick the same one; the `INSERT` then fails on the primary key, nothing is written, and the action retries once.

Where the apps rely on this:

- **Offline mutations**: each action writes the optimistic change to the mirror and inserts the zod-validated `outbox` row in one batch. If either fails both roll back, so the UI never shows a write that was not queued, and live queries re-fire on commit. Validation runs before anything is sent: a bad payload throws and nothing is written. The replay trigger fires after the write committed, so replay sees the row.
- **Delta sync**: the page applier (`apps/mobile/src/sync/remote/applier.ts`) writes a page's rows, its tombstones and the advanced resume cursor in one batch. A crash mid-page leaves the cursor where it was, and the page is fetched and applied again (the writers are idempotent). Sharing has no tombstones on the server, so that set is reconciled by a periodic reseed of its small feed.
- **Shared uploads** land whole or not at all (`enqueueSharedUploads`).
- Diagnostics, sync-log lines and upload progress are display only: they are written in order on the serial connection and never awaited, and a failure there is never fatal.

### Writers

`src/writers.ts` upserts server rows into the remote mirror with `ON CONFLICT DO UPDATE` on the server id, so a reseed or a pull-to-refresh converges without duplicates. There are two layers:

- `*Sql(rows)` builds the statements and runs nothing. A caller that must write several things atomically (the page applier) concatenates them and runs them as one batch.
- `upsert*(db, rows)` and `delete*(db, ids)` run them, each chunk of `BATCH_SIZE` (1,000) rows as its own batch, so a seed of 100,000 photos never holds one giant transaction and live queries show progress.

`deleteOwnedRemotePhotosByHash` drops the owner's photos with the given image hashes after the server deleted them for good. It matches the server, which deletes every row of the requester's that carries the hash (`image_hash` is not unique) and only theirs, so another user's shared photo with the same hash stays. Each statement selects by owner and hash itself, so the batch is atomic without reading ids first.

Mapping API responses onto the writers' inputs is the app's job (`apps/mobile/src/sync/remote/mappers.ts`, `pig-photo.ts`): the package does not depend on the API client. The seed's timeline list does not carry the media categories; the delta feed does. `is_favorite` is materialised from `rating >= favorite_min_rating` when a row is mapped.

## The schema

`src/schema.ts` is the Drizzle schema and the single source drizzle-kit generates the SQL migrations from. Its tables fall into three groups:

- **remote mirror**: flat summaries of server state (own and shared photos, albums, people, things, tags, places, shared users). Disposable: it can always be re-seeded from the API.
- **local media**: what is on this device. On the phone that is the camera roll (`local_album.source = 'device'`); on the desktop the folders the user added (`source = 'folder'`), whose files are referenced in place. One set of tables serves both, so the timeline, hashing and backup code is the same.
- **app state**: sync cursors, the offline outbox, the upload, job and thumbnail queues, logs.

Timestamps are integer milliseconds since the epoch (Drizzle `mode: "number"`), never `Date`, so they round-trip identically through every driver. Flags are integers with `mode: "boolean"` for the query builder; raw SQL sees 0 and 1.

Columns whose meaning is not in their name:

| Column | Meaning |
| --- | --- |
| `local_asset.id` | Phone: the MediaLibrary asset id. Desktop: any stable id; the file path is used. |
| `local_asset.type` | `'image'`, `'video'` or `'raw'`. |
| `local_asset.uri` | Phone: `ph://` or `content://`. Desktop: the file's absolute path. |
| `local_asset.hash` | The server's image hash (MD5 of the bytes plus the user id); null until hashed. |
| `local_asset.hash_state` | `'icloud'` (`HASH_STATE_ICLOUD`): the bytes are in iCloud, not on the phone. `HASH_STATE_UNREADABLE`: the desktop could not read the file, and it is skipped until it changes. |
| `local_asset.created_at` | When the picture was taken (or else the file time): the timeline's sort key. |
| `local_asset.bucket_day` | `'YYYY-MM-DD'` of `created_at` in the user's calendar, written by the app (the phone: the device time zone; the desktop: the picture's wall-clock date). Null falls back to SQLite's `localtime`. Groups the timeline by day and gives the search index its date words. |
| `local_asset.folder` | Desktop only: the folder as the user sees it, the added folder's own name and then the subfolders ("Pictures/Holiday 2019/Day 1"). Searchable word by word. |
| `local_asset.taken_at` | Desktop only: the date-taken text from the metadata; null when `created_at` is the file time. |
| `local_asset.format` | Format name ("JPEG", "HEIC", "CR3", ...). |
| `local_asset.meta_state` | Desktop metadata pass: null (not tracked, the phone), `'pending'`, `'done'` or `'failed'`. |
| `local_album.backup_selection` | 0 none, 1 selected, 2 excluded. |
| `local_album.path`, `added_at` | Desktop folder root: its absolute path and when it was added. Null for a device album. |
| `upload_queue.upload_id`, `upload_offset` | Resumable chunked upload: the server's upload id and the bytes it acknowledged, so a restart continues from the offset. |
| `remote_photo.archived` | Off the timeline and Memories (#545). |

The local full-text index (`local_asset_fts`, its terms view and triggers) is hand-written SQL in `migrations/0001_local_search.sql`, because drizzle-kit does not model FTS5.

## Migrations

```bash
npm run db:generate --workspace packages/local-db
```

runs `drizzle-kit generate`, which writes plain SQL migrations and the journal into `migrations/`, and then `node scripts/build-migrations.mjs`, which turns them into `migrations/migrations.json`: an ordered array of `{ tag, statements[] }`. Every runtime applies that file and nothing else: the TypeScript runner imports it, the desktop's Rust side embeds it with `include_str!`. A statement is one chunk between drizzle-kit's `--> statement-breakpoint` markers, so a trigger body with inner `;` stays whole; full-line `--` comments are dropped, so each entry is exactly one statement. `npm run db:check` (`build-migrations.mjs --check`) exits 1 when the file is stale or missing, and CI runs it.

Bookkeeping is one table every runtime shares:

```sql
CREATE TABLE IF NOT EXISTS __local_db_migrations (tag TEXT PRIMARY KEY, applied_at INTEGER NOT NULL);
```

`runMigrations(executor)` runs before any query:

1. Create the bookkeeping table if it is missing and read the applied tags.
2. For each migration in array order whose tag is not applied, run its statements and insert its tag in **one batch**, so it lands whole or not at all.
3. If that fails (a database from an older, squashed schema, a half-written file), **wipe and rebuild**. The remote mirror is disposable, so only `outbox` and `upload_queue` (`PRESERVED_TABLES`) must survive; sign-in lives outside the database. Their rows are read out, then every view is dropped (views reference tables), then every virtual table (FTS5 shadow tables such as `x_data` and `x_idx` go with their table `x`), then every other table, the bookkeeping table included. The schema is rebuilt from the migrations, recording each, and the saved rows are put back with only the columns the new tables still have (`INSERT OR IGNORE`). The caller then runs a full seed.

The desktop implements the same algorithm against the same file, so either app can open a database the other migrated. The mobile app has never shipped, so its history was squashed into one baseline; from now on migrations only append.

### Adding a column

1. Add it to the table in `src/schema.ts` (and to the row type in `src/types.ts` if a query returns it).
2. Run `npm run db:generate --workspace packages/local-db` and commit the new SQL file, the journal and `migrations.json`.
3. If the column is searchable, change the `local_asset_search_terms` view and the triggers in a new hand-written migration, as `0001_local_search.sql` did.
4. Fill it where the rows are written: a writer and the app's mapper for mirror tables, the scan or the file seams for local media.
5. Test the queries that read it, and run the checks below; `db:check` fails when `migrations.json` was not rebuilt.

## The change hub

`createChangeHub({ subscribe, defer?, quietMs?, maxWaitMs?, deferCapMs? })` turns raw change events into a few **flushes** per second, scoped by table, and live queries watch it with `hub.watch(tables | null, (changed) => ...)`. It is plain TypeScript with no React and no platform code, tested in Node with fake timers against a real better-sqlite3 database.

A runtime feeds it either its own update hook or `trackChanges(executor)`:

- the phone: expo-sqlite's `addDatabaseChangeListener`, bridged to the hub's `subscribe` in `DatabaseGate.tsx`;
- the desktop: rusqlite's update hook forwarded as Tauri events, or `trackChanges`;
- Node tests: `trackChanges`, which wraps an executor and reports every successful write once per statement (not per row). `writtenTables(sql)` gives the tables a statement writes: none for a read, several for a CTE or trigger body, and null for a change that names no table (DDL, `PRAGMA`), which wakes every watcher. Writes that happen inside triggers are not reported, so watch the table the statement names (`local_asset`, not `local_asset_fts`).

### Why it exists

An update hook is `sqlite3_update_hook`: it fires once per changed **row**, not once per commit. A camera-roll scan of a library of about 2,900 photos produced roughly that many events each for the asset upserts, the album links and the hash pass, with queue and log churn on top: well over 10,000 events. Before the hub, each one re-ran every mounted live query, and the most expensive of them, the merged timeline (a `UNION ALL` that sorts every remote photo and local asset), ran ten thousand times on the JS thread. That was the jank behind "scanning the camera roll makes the app very unresponsive".

The hub absorbs that storm:

- **trailing debounce** (`quietMs`, default 90 ms): a burst becomes one flush;
- **max wait** (`maxWaitMs`, default 450 ms): under a continuous stream the debounce would never settle, so a flush is forced at least this often. Photos keep appearing while a scan runs;
- **table scoping**: a watcher may declare the tables its query reads, so a write to `local_asset` does not re-run a query that only reads `remote_photo`. A watcher that declares nothing is woken by everything, and an event that names no table wakes everyone: both defaults fail safe, with an extra re-run and never a missed one;
- **interaction deferral** (`defer`, capped by `deferCapMs`, default 1.5 s): re-querying mid-gesture reflows a list under the user's finger, so a flush waits while they scroll, but never longer than the cap.

Coalescing cannot drop the final update. A flush carries no data; it is a signal to re-read, and the re-read sees the database as it is when it runs, so merging ten flushes loses nothing but work. And a flush always happens after the last change: every change re-arms the timer, which only another change or `close()` cancels. After the last change at time T a flush runs by T + `quietMs` (T + `deferCapMs` mid-gesture) and sees the final state.

## Live queries in the mobile app

Screens read synced entities through `useReactiveQuery` (`apps/mobile/src/db/provider.tsx`), which re-runs a query when the tables it reads change:

```ts
const { data, loading } = useReactiveQuery(["people"], (db) => people(db), [] as PersonRow[], {
  tables: ["person"],
});
```

The hook is a TanStack Query observer on a `QueryClient` of its own, private to the database provider and separate from the app's network queries. Each hub flush invalidates the live queries that read a changed table: an active one re-reads, an inactive one is marked stale for its next mount. Its semantics:

- **cached per key**: a screen that remounts paints its last result in its first frame and re-reads in the background, so there is no empty flash. Results nobody shows stay cached for ten minutes;
- **previous value while re-reading**: after a change the current data stays on screen until the new rows arrive. `keepPrevious` extends that to a key change, such as a growing page or a new search term;
- **first-load state**: `loading` is true until there is a result for the current key. Show an empty state only when `loading` is false, or "no photos" flashes before the rows;
- **no stale overwrite**: a read that finishes after a newer read of the same key started answers with the newer read's result, so old rows can never replace newer ones (TanStack only cancels an in-flight read once the query has data, not on its first load);
- **never paused**: `networkMode: "always"`, because the reads are local.

The rules for callers:

- The **key** names the query and every input it reads (an album id, a filter, the chosen sort). Results are cached per key, so two queries must never share one, and an input missing from the key means a stale answer. A filter object goes into the key by its fields, so one rebuilt on every render keeps its key.
- **`tables`** lists the tables the query reads; only writes to them re-run it. Omitting it is always correct (any change re-runs the query). Declare only tables you checked against the query's SQL: an under-declared list shows stale data. The Memories card in the timeline header declares `remote_photo` only, so the camera-roll scan's `local_asset` churn does not re-run it while the user scrolls.
- **`placeholder`** is `data` until the first result; the first render's value is kept, so an inline `[]` stays one stable array.

`DatabaseGate.tsx` opens the database, runs the migrations, and reads the timeline's first page and day buckets into the live-query cache (`prefetchTimeline`) before it renders the app, waiting at most `WARM_UP_BUDGET_MS`, so the timeline paints rows in its first frame after a cold start. It is mounted inside the signed-in area, so the mirror is always migrated before any live query runs.

Grid tiles find their offline thumbnail through one loader (`apps/mobile/src/components/useThumbSource.ts`): one query per tile would be hundreds of bridge round trips per screen, so every photo id requested in the same tick is answered by one `IN (...)` query, cached per photo as a live query on `thumb_cache`. While that lookup runs the tile shows its dominant colour, so it never loads the server thumbnail first and then the cached file.

## How the apps use it

### Mobile

`src/db/` in `apps/mobile` is the app glue only:

- `client.ts`: the phone's executor. expo-sqlite's async API over one database file, opened with `journal_mode = WAL` (readers never wait for the writer) and `busy_timeout` (a background task's connection and the app's wait for each other instead of failing), with the change listener on. Every call goes through a serial queue, because a batch's `BEGIN ... COMMIT` must not interleave with another caller's statement. expo-sqlite's own `withExclusiveTransactionAsync` is not used: it opens a second connection, which the change listener does not watch. Prepared statements are kept in a small LRU, and every method steps every row, `"get"` included, so a `RETURNING` statement writes them all.
- `DatabaseGate.tsx`: open, migrate, warm up, and bridge the change listener to the hub. The listener forwards each event's table name, so the hub can skip queries that do not read it.
- `provider.tsx`: `DbProvider` and `useReactiveQuery`.

The mobile lint rules keep it that way: only `client.ts`, `DatabaseGate.tsx` and the key-value preferences store (its own file) may import `expo-sqlite`, and nothing imports `drizzle-orm/expo-sqlite` or `better-sqlite3`. The app's jest `node` project runs the sync and mutation tests on the package's test database; the database's own tests live in the package.

### Desktop

The desktop's folder library maps onto the same tables as the camera roll (`src/queries/library.ts`). A folder the user added is a `local_album` with `source = 'folder'` and its absolute `path`; each file under it is a `local_asset` whose `uri` is the file path, linked to the root through `local_album_asset`. Files are referenced in place. The desktop's file seams hand their findings to the writers as data:

- walk batches and the watcher's created and modified files go to `upsertWalkedFiles`. Rows are matched by path. A new file gets its path as id and `meta_state = 'pending'`; a known file whose size or mtime changed is new content, so its hash and metadata are asked for again; an unchanged one keeps both, so a rescan costs nothing. Each chunk of 500 files is one batch of three statements over the chunk as a table, which makes a 2,000-file walk several times faster than statements per file;
- removed paths (a file or a whole folder) go to `removeLocalPaths`, which forgets each path and everything below it;
- renames go to `renameLocalPaths`: the row stays, so its hash, metadata and upload state survive, and a folder rename moves every file below it;
- metadata reads for the files `pendingMetadata` hands out go to `applyFileMetadata`; paths that could not be read are not asked for again until they change;
- MD5s go to `setFileHashes`, stored as the server matches photos (`image_hash` is the MD5 plus the user id). `markHashUnreadable` parks a file the desktop could not read.

A file sorts by its date taken as wall-clock milliseconds (`takenMs`, its day read with UTC getters) once its metadata is read, and by its mtime (its day in the local time zone) until then or when it has no date. A file's searchable folder starts at the added folder's own name: words above it ("C:", "Users") would match every file.

A **loose file**, one the user opened from outside the library and asked about or to upload (`upsertLooseFile`), is a `local_asset` without a root link: it shares the hash cache and the upload queue but never shows in the library views. Removing a root, or a path under it, keeps the files that have a live upload, as loose files.

## Local search

`local_asset_fts` (FTS5) indexes every local asset under its name, its kind, its folder words, date words from `bucket_day` (year, month names, `yyyy-mm`, `yyyy-mm-dd`), "undated" when the metadata pass found no date, and its format, camera and lens. The terms are defined once, in the view `local_asset_search_terms`, and triggers on `local_asset` keep the index in sync, so nothing in the package writes it except `rebuildLocalSearch`, which you run after a `VACUUM` (it may renumber the rowids the index uses).

`searchLocalAssets(db, query)` splits a query into words the way FTS5's `unicode61` tokenizer splits text (lower case, on anything that is not a letter or digit), and every word must prefix-match one of a file's words: "march 2023", "canon raw", "holiday 2019 heic".

## The upload queue

`src/queries/upload-queue.ts` owns which local assets get queued, which run next and the state transitions; the workers in the apps drive the state machine.

- **Enqueue rule** (`enqueueBackups`): a local asset that is hashed, is in a backup-selected album, is in no excluded album, and whose hash has no `remote_photo` counterpart. Existing rows, in any state, are left alone.
- **iCloud exception**: an asset the hash pass parked as `hash_state = 'icloud'` has no hash because its bytes are not on the phone. Refusing to queue it would drop most of the library on an iPhone with "Optimise iPhone Storage", so it is queued unhashed and the worker downloads it once and hashes the bytes on their way out.
- **Order**: hashed assets first, then first in, first out. An unhashed row needs a download first, and letting one to the front would park the serial queue on a network fetch while files on the disk wait.
- **Retries**: a failure bumps the attempts and sets a backoff of `BACKOFF_BASE_MS * 2^attempts`; after `MAX_ATTEMPTS` the row is parked as failed until the user retries.
- **Processing on the server** (#2740): once the bytes are uploaded the row records the server's photo id, and the timeline shows an hourglass on that camera-roll row until the mirror has the photo with a thumbnail.
- **Concurrent workers** (the desktop): `claimNextUpload` claims atomically, and a file whose hash another row is already uploading (two copies of one picture) waits. `claimExistenceChecks` claims hashed rows for a server existence check; the checker answers each with `markSkipped` (the server has it) or `markAbsent` (back to pending, marked as checked so it is not claimed for a check again). `setUploadProgress` records how far a resumable upload got, and `resetInFlightUploads` runs at startup, before any claim, so work a previous run stopped in the middle of starts over from its saved offset. `switchFolderAccount` rebuilds every hash for another server account and starts the queue over; `cancelFolderBackups` drops queued uploads of files in no backed-up root when backup is turned off.

## Testing

`createTestDb()` from `@librephotos/local-db/testing` is an in-memory database with the real schema, applied from the same `migrations.json`, behind the same async executor contract the apps implement. There are no mocks, so a query passes here exactly when it passes on the phone. It is synchronous, so it fits a plain `beforeEach`, and writes through its `db` or `executor` are reported to its `subscribe` per table, the way the apps' change listeners report them, so live-query code can be tested against it. `rawCount(t, sql)` counts straight on the raw connection, for assertions inside a synchronous callback (a progress seam) where the async `db` cannot be awaited.

In the mobile app, `renderWithDb` (`src/test/test-utils.tsx`) renders a screen over a test database with the app's providers and a mocked API client and waits for the first reads; pass the test database's `subscribe` to have writes re-run live queries. Reads are async (the executor resolves on a microtask, TanStack Query notifies on a macrotask), so a test calls `settleDb()` after a render or a press before it asserts. Package tests say "this is here" with `defined(value)`, which fails on the spot, rather than a non-null assertion that only claims it. The vitest timeouts are long because the `EXPLAIN` budget test seeds 100,000 rows before it asserts anything.

## Adding a query

1. Write it in the matching module under `src/queries/` as an async function that takes an `AppDatabase`, in raw SQL with `` db.all<Row>(sql`...`) `` or `db.get<Row>(...)`, and export it from `src/queries/index.ts`. A write that must be atomic is one statement or one `runBatch`.
2. Test it in `src/__tests__/` against `createTestDb()`. A query the timeline runs often belongs in `explain.test.ts`, which checks its `EXPLAIN QUERY PLAN` over 100,000 rows uses an index and no temporary sort.
3. In the mobile app, read it with `useReactiveQuery`, with a key that carries every input and a `tables` list checked against the SQL.

## Checks and CI

```bash
cd packages/local-db
node ../../node_modules/typescript/bin/tsc --noEmit
node node_modules/eslint/bin/eslint.js src scripts
node node_modules/vitest/vitest.mjs run
node scripts/build-migrations.mjs --check
```

or `npm run typecheck|lint|test|db:check --workspace packages/local-db`. The `local-db` workflow (`.github/workflows/local-db.yml`) runs them, installing only this workspace's dependencies from the root lockfile; better-sqlite3 13 ships its native binaries in the package (`prebuilds/`), so there is no build step. The mobile workflow runs the app's own tests against the package. `node scripts/check-shared-deps.mjs` also fails when the mobile app's `drizzle-orm` does not satisfy the package's peer range, or when the root lockfile nests a second `drizzle-orm` under `apps/mobile` or the package: two copies would mean two sets of Drizzle classes in one bundle.
