# librephotos-ts: agent guide

An experimental big-bang rewrite of the LibrePhotos backend API in
**TypeScript on Bun**, using **TanStack Start** server routes and **Drizzle**.
It is the third contender next to Django (`apps/backend`) and the Rust rewrite
(`apps/backend-rs`, plan in `plans/rust-backend/`). The goal is a speed and
footprint comparison, so the scope is the same as Rust's: exactly the API the
React frontend uses (`plans/rust-backend/03-api-surface.md`), Postgres only.

## Reference implementations

- **Rust is the primary reference.** Every endpoint, query and side effect
  already exists in `apps/backend-rs/crates`, and it passes the contract,
  twin and mutation suites against Django. Port from it: the SQL in
  `lp-db/src/<area>` and `lp-db/src/write/<area>` usually translates 1:1.
  - HTTP handlers: `lp-api/src/<area>/`, `lp-auth`, `lp-media`
  - SQL: `lp-db/src/<area>/`, writes in `lp-db/src/write/<area>/`
  - Jobs: `lp-jobs` (queue, already ported to `src/lib/jobs.ts`), `lp-tasks`, `lp-ingest`
- **Django is the behavioral reference** (`apps/backend/api`): the suite
  compares against a live Django, so when Rust and Django disagree, Django wins.
- Skip Rust-only things the frontend never sees: SQLite dialect code, in-process
  ML (TS calls the Python ML sidecars over HTTP, like Django), the CLI.

## Layout

```
server.ts               production entry: Bun.serve -> built Start handler, starts the job worker
src/cli.ts              `bun run src/cli.ts adopt` (idempotent, applies migrations/*.sql + constance import)
migrations/*.sql        the same additive objects librephotos-rs creates (job_queue, refresh_token, ...)
src/db/schema.ts        Drizzle schema, introspected from the adopted fixture (drizzle-kit pull)
src/db/relations.ts     Drizzle relations (generated)
src/lib/                shared infrastructure (see below)
src/features/<area>/    endpoint logic per area (plain functions)
src/routes/api/...      thin TanStack Start file routes, one per URL
src/jobs/index.ts       imports every area's job handler module
```

## Running

```bash
cd apps/backend-ts
bun install
bun run build                       # vite build -> dist/ (also regenerates src/routeTree.gen.ts)
bun x --bun tsc --noEmit            # typecheck (must stay clean)
# against a DB clone (see the harness README for clones):
TZ=UTC DB_HOST=localhost DB_PORT=5433 DB_USER=postgres DB_PASS=x DB_NAME=<clone> SECRET_KEY=rust-bench-secret \
  BASE_DATA=C:/Users/Niaz/librephotos/rust-pg/fixture LP_BIND=127.0.0.1:8899 bun run server.ts
```

`bun run build` must be rerun after every change before the suite sees it.
Routes are files: `src/routes/api/albums/date/list.ts` serves
`/api/albums/date/list` and `/api/albums/date/list/` (both slash forms match).
Dynamic segments are `$name` (`src/routes/api/user/$id.ts`), `$` is a splat.
Static segments win over dynamic ones. `src/routes/api/$.ts` is the JSON 404.

## The contract suite (how you know you're done)

The Rust experiment's harness runs unchanged against the TS server:
`apps/backend-rs/tests/README.md` explains the fixture, clones, twins and
mutation diffs. Run it with `LP_SUITE_RS=ts`:

```bash
cd apps/backend-rs/tests/contract
export PATH="/c/Users/Niaz/AppData/Roaming/fnm/node-versions/v22.23.3/installation:$PATH"
npm install                     # once per worktree
LP_SUITE_RS=ts LP_SUITE_PORT=<your port block> LP_SUITE_DB_PREFIX=lp_run_<you>_ \
  LP_SUITE_OUT=C:/Users/Niaz/librephotos/rust-pg/fixture-runs/ts-<you> \
  bash run_suite.sh <area> mut:<area>
```

A unit is done when it passes. Logs: `$LP_SUITE_OUT/<unit>/vitest.log` and
`.../rs-logs/ts.log` (server stdout). The `.accept` files list differences
already accepted for Rust; they apply to TS too. Never loosen a test or a
schema to make TS pass; if a case is wrong, say so in your report.

## Conventions

**Endpoints** (`src/lib/http.ts`):

```ts
export const Route = createFileRoute("/api/user/$id")({
  server: { handlers: {
    GET: endpoint("optional", ({ user, params, query, request, url }) => getUser(user, params.id, request)),
  } },
});
```

- Auth modes: `none | optional | user | admin | cookie | cookie-optional`
  (DRF semantics, see the comment in http.ts). Return a plain object for 200
  JSON, a `Response` for anything else (`json(body, status, headers)`), or
  throw an `ApiError` (`src/lib/errors.ts`) for the `{"errors":[...]}` envelope.
- Bodies: `jsonBody(request)` (DRF ParseError on bad JSON), `anyBody(request)`
  for JSON/form/multipart. Query strings: `query` is a `QueryMap` with
  Django's QueryDict semantics (`get` = last value, `flag`, `int`, `nonEmpty`).
- DRF pagination: `src/lib/pagination.ts` (`pageRequest`, `validFor`, `drfPage`).
- Keep route files thin; put logic in `src/features/<area>/`.
- Define handlers for exactly the methods Django allows. A method without a
  handler falls through to Start's SSR page, which server.ts turns into DRF's 405.

**Database** (`src/lib/db.ts`): Drizzle over Bun's native Postgres driver.

- Use the Drizzle query builder (`db.select()...`, `db.insert(schema.apiX)...`,
  `db.update`, `db.delete`, `inArray`, `eq`, transactions with
  `db.transaction`) for simple CRUD. Use `rows(sql\`...\`)` / `row(...)` with
  Drizzle's `sql` template for complex reads (CTEs, aggregates, json_agg): port
  Rust's SQL there. `client` (Bun's raw tagged template) is fine for one-off
  statements in infrastructure code.
- **Datetimes:** Bun parses timestamptz into a JS `Date` (milliseconds only) and
  Drizzle string-mode columns come back as `"2026-10-07 05:58:18.866+00"`. API
  output needs Django's microseconds, so format in SQL: `drfTs("p.added_on")`
  (DRF `...Z`) or `pyIsoTs(...)` (`...+00:00`) from `src/lib/time.ts`. For
  builder selects use `sql<string>\`${drfTs(sql\`api_x.col\`)}\`.as("col")`
  (see `userColumns` in `src/lib/users.ts`). Parse client datetimes with
  `parseClientDatetime`.
- **bigint / count(\*)** come back as strings: cast `count(*)::int` in SQL.
- **jsonb parameters:** `jsonbParam(v)` in `sql` templates (scalars too). The
  schema's `jsonb` columns are fixed for the builder (objects/arrays/strings);
  a number/boolean into a jsonb column needs `jsonbParam`.
- **Arrays:** a bare JS array in a Drizzle `sql` template expands to
  `($1, $2, ...)`. For ONE array parameter use `pgArray(ids, "uuid")`
  (`= ANY(${pgArray(...)})`); in raw `client` queries use
  `${arrayLiteral(ids)}::uuid[]`. Bun's own array binding is unreliable here.
- **Authorization scopes:** `src/lib/scope.ts` (`ownedBy`, `visibleTo`,
  `visibleManager`, `photoFilters`, `photoGrantsSelect`, ...). Never inline
  owner/visibility conditions; a missing scope is a security bug
  (GHSA-phvg: an album share only vouches for the album owner's photos).
- **PigPhoto lists:** `src/lib/pig.ts` (`pigFetch(sql\`WHERE ... ORDER BY ...\`)`,
  `pigByIds`, `groupByDate`).
- **Users:** `src/lib/users.ts` (`userById`, `simpleUser`, `User` has DRF-string datetimes).
- **Site settings:** `siteSettings()` (`src/lib/settings.ts`, 2 s cache; call
  `invalidateSettings()` after writing).
- **Jobs:** `src/lib/jobs.ts`. `enqueue(kind, payload, { lrj: { jobType, userId } })`
  from routes; `registerJob(kind, handler)` in `src/features/<area>/jobs.ts`,
  imported from `src/jobs/index.ts`. Use the same job kinds and payloads as
  Rust (`lp-tasks/src/lib.rs` registry) so both servers can share a queue.
- **Config:** `src/lib/config.ts` (same env names as Django/Rust).

**Performance is the point of the experiment.** Match Rust's query count (2-3
statements per endpoint, no N+1), fetch exactly the fields the frontend reads,
build JSON in SQL (`json_agg`) when Rust does. Avoid per-row awaits in loops.

**Style:** TypeScript strict, no `any` where a type is easy, comments only for
the non-obvious (a Django quirk being reproduced, a security rule). Each file
starts with a short comment naming what it ports.

## Out of scope

SQLite, Django admin, the mobile-only CLI, in-process ML, Windows standalone.
Do not modify `apps/backend` (Django) or `apps/backend-rs/crates` (Rust).
Harness changes (`apps/backend-rs/tests`) only to fix a harness bug, and say so.
