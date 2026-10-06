# 02 — Data Layer

**Postgres only.** SQLite (unified image, Windows standalone) is out of scope
for the experiment.

## 1. Adopting the existing schema

The rewrite **keeps Django's schema**. Two reasons:

- the benchmark has to run both backends on the same data
- you should be able to point the Rust backend at a copy of a real library

| Step | What |
| --- | --- |
| Pin | Take `dev` at the start of M0 (3bbef0e9a has `api.0142`; re-pin if newer migrations such as #2121's SQLite-only `0143` have landed by then, since `adopt` compares the migration list exactly). Migrate a fresh Postgres with Django, then `pg_dump -s` the **application tables only**: `api_*`, their M2M link tables, and `chunked_upload_chunkedupload`. |
| Baseline | That dump becomes `migrations/0000_baseline.sql`. A fresh install runs it, then Rust's own migrations. |
| `adopt` | For an existing Django DB, check that `django_migrations` holds exactly the pinned set. Otherwise refuse, with "run Django to api.0142 first". Record the baseline as applied, then run the Rust migrations. |
| Rust migrations | **Additive only** during the experiment: new tables (`site_settings`, `job_queue`, `refresh_token`), new indexes, new nullable columns. Never drop or rewrite Django tables. |

**Additive-only is a feature.** Django and Rust can take turns on the same
database copy, which is how the benchmark runs (05). Any index Rust adds
benefits Django too, so the comparison measures the app layer, not an index
the other side lacks.

It also means **Rust writes must stay Django-readable** (§3 codecs), so that
switching back to Django on a Rust-touched DB still works.

**Django-only tables** are left untouched in adopted DBs and never created in
fresh ones:

- `auth_group*`, `auth_permission`
- `django_*`
- `constance_*`
- `account_*`, `socialaccount_*`
- `django_q_*`
- `token_blacklist_*`

Known schema warts inherited from the 0099 UUID change stay as they are:

- FKs to `api_photo` from 15 tables are `ON DELETE CASCADE`/`SET NULL`;
  the others have no action.
- The link-table `photo_id` columns are nullable.
- `api_photo_files` / `api_photo_shared_to` lack unique pairs.

Rust's delete code handles all of this explicitly (§5).

## 2. sqlx conventions

- **Runtime-checked queries (deviation, decided in M0):**
  `sqlx::query_as::<_, Row>(sql)` with `#[derive(FromRow)]` row structs, not
  the `query!`/`query_as!` macros. About 11 agents implement areas in
  parallel worktrees; runtime checking means no `DATABASE_URL` at build time
  and no `.sqlx/` offline files to conflict on. The cost is that a column
  typo fails at test time instead of compile time, so every query needs a
  test that runs it (lp-testkit makes that cheap).
- **Dynamic filters** (the photo filter builder, search, list endpoints with
  optional params): `sqlx::QueryBuilder`, with the authz and filter
  fragments in `lp_db::scope`. Handlers never concatenate SQL; clippy
  `disallowed-methods` keeps `sqlx::query*` out of `lp-api`, `lp-media` and
  `lp-auth`.
- **Layout:** one module per area (`lp_db::<area>` for reads,
  `lp_db::write::<area>` for writes) returning row structs. `lp-api` maps
  rows to response DTOs, so shapes the frontend needs don't leak into
  queries. The shared photo summary is `lp_db::pig`.
- **Big lists** (timeline pages of up to 5000 items, album lists) are
  fetched with one query each plus at most one batched follow-up per
  relation (`= ANY($1)`), never per row.

## 3. Codecs: Django's storage formats

| Newtype | Stored as | Notes |
| --- | --- | --- |
| `FileHash` | varchar(64) `md5hex + str(user_id)` | `File.hash` PK and `Photo.image_hash` (not unique). Also names thumbnail files. |
| `FaceEncoding` | text, `ndarray.tobytes().hex()` of **float64 LE**, 512-d | Same for `Cluster.mean_face_encoding` |
| `ClipEmbedding` | jsonb list of 512 floats + `clip_embeddings_magnitude` | Unnormalized. Tolerate the legacy double-encoded string form. |
| `DominantColor` | text `"[r, g, b]"` | Python list repr |
| `MediaPath` | relative path text (Django `FileField`) | Resolve against `MEDIA_ROOT`, then confine (03) |
| `JsonCol<T>` | jsonb | Distinguish SQL NULL from JSON `null`; Django filters treat them differently |
| `VideoLength` | text | Yes, text |
| Timestamps | `timestamptz` | UTC everywhere, like Django `USE_TZ=True` |
| Encrypted fields | django-cryptography pickles (Nextcloud app password, SMTP secret) | Readable and writable from Rust: `lp_core::django_crypto` ports the Fernet variant (AES-256-CBC, key = PBKDF2(SECRET_KEY), HMAC-SHA256 with SECRET_KEY) and pickles only `str`. New users get an encrypted `""`, which Django decrypts. |

**Site settings:** `adopt` imports constance rows into `site_settings` once,
by decoding constance 4.x's JSON codec. Inspect real rows first: the 0127 and
0138 migrations disagree on the format. Keys with no row get the same env-
derived defaults as `CONSTANCE_CONFIG`. Settings are cached in an `ArcSwap`
and reloaded on write.

## 4. Authorization scopes (`lp-db::scope`)

These are named SQL fragments, each ported from one Django concept and never
inlined in handlers:

| Rust | Django | Semantics |
| --- | --- | --- |
| `owned_by(user)` | `PhotoQuerySet.owned_by` | `owner_id = $user` |
| `visible_to(user)` | `PhotoQuerySet.visible_to` | `public OR owner OR EXISTS(shared_to)` (EXISTS rather than a join, so duplicate link rows can't duplicate results) |
| `visible_manager()` | `Photo.visible` | not hidden / trashed / removed, **and** a thumbnail with `aspect_ratio IS NOT NULL` |
| `photo_filters(user, params)` | `build_photo_queryset` | Always owner-scoped; 11 optional filters; any non-empty query string counts as true |
| `tag_visible` / `album_thing_visible` | counter filters | Two more "visible" definitions used for counts. Keep them separate. |
| `album_share_grants(photo, user)` | media view grant order | An album share vouches **only for the album owner's photos** (GHSA-phvg-g65q-rhq3) |

The authz matrix in 06 checks each scope as sets of photo ids per role
against Django on the same fixture.

## 5. Side effects are explicit write services

There are no signals. Every mutation goes through `lp-db::write::*`, which does
its side effects in the same transaction. `clippy.toml` `disallowed-methods`
keeps raw `INSERT/UPDATE/DELETE` helpers out of handlers.

**Kept** (the frontend shows these results):

| # | Trigger | Effect |
| --- | --- | --- |
| S1 | photos added/removed on AlbumThing | recompute `photo_count` (hidden=false), top up `cover_photos` to 4 |
| S2 | photos added/removed on Tag | recompute `photo_count` (visible filter) |
| S3 | Person deleted | detach faces (`person_id = NULL`) first; the FK has no DB action |
| S4 | Face deleted | delete the crop file after commit |
| S5 | Thumbnail deleted | delete thumbnail files after commit if no other photo uses the hash |
| S14 | any update of a model with `auto_now` | bump `last_modified` / `updated_at` (27 fields), so Django stays consistent when taking turns |
| S15 | user deleted | 13 FKs reassigned to the `deleted` sentinel user (create it if missing) |
| S16 | rating/date edit with `save_metadata_to_disk` on | write XMP:Rating / XMP:DateCreated through the ExifTool pool (file or sidecar) |
| S17 | share created | slugs: `AlbumUserShare` 12 hex (`-N` on clash); `PhotoShare` `token_urlsafe(9)` |
| S18 | OCR stored | truncate text to 20k chars, blocks to 500 |
| S19 | face labeling / person rename / caption change | `Person.face_count`, `cover_photo`, `cover_face`; rebuild `PhotoSearch.search_captions` |
| S20 | trash / hide / delete | tag photo counts; `Duplicate.potential_savings` / `trashed_count` |
| S21 | email config saved | singleton row `pk=1` |
| S22 | chunked upload deleted | delete the staged file |

**Mobile sync (added later):** the `/api/sync/*` port brought back the
`DeletionLog` tombstones and the sync `last_modified` bumps of
`api/sync_signals.py` (`lp_db::write::deletion_log`): hard deletes of photos,
user/auto albums, tags and `USER` persons tombstone the owner and every
recipient; removing a share tombstones that recipient; adding one clears the
stale tombstone; tag link changes and thing-album cover top-ups bump
`last_modified`. `maintenance.prune_deletion_log` drops tombstones after 90
days. Still dropped: S6–S13.

**Hard deletes** reproduce Django's collector as one ordered transaction.
- Delete explicitly (no DB cascade): `api_photometadata`,
  `api_metadatafile`, `api_metadataedit`, `api_photo_ocr`,
  `api_photoshare`, `api_tag_photos`, `api_photo_stacks`,
  `api_photo_duplicates`.
- Null out: `api_duplicate.kept_photo_id` and
  `api_stackreview.kept_photo_id`.
- Let the DB cascade handle the rest.
- Files are removed after commit.

06 diffs the resulting DB state against Django's `photo.delete()` on the same
fixture.

## 6. Query performance: where Rust can win without cheating

- **Grouping in the query.** Timeline grouping (`PhotosGroupedByDate`) happens
  in Python over ORM objects. Rust streams sorted rows and groups while
  serializing, with no intermediate objects.
- **Only the columns the frontend reads** (03 lists them). DRF serializers
  hydrate full model instances.
- **Batched relations** instead of per-item `SerializerMethodField` queries.
- **Measure it, don't assume it.** The benchmark records statements per
  request on both sides via `pg_stat_statements`, so the report can say how
  much comes from fewer or better queries and how much from the runtime.
  Django can adopt the first kind of win; the second is what Rust uniquely
  buys.

## 7. Connections

- sqlx pool of `2 × cores` by default, as a named `LP_DB_POOL`.
- Postgres runs with `pg_stat_statements` enabled in the benchmark setup.
- Django's comparison config is `CONN_MAX_AGE=600`, one connection per
  thread, as shipped.
