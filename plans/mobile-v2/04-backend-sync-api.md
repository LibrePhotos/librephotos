# 04 — Backend Sync API (Django)

The server work that makes the mirror possible. Deliberately simpler than
Immich's streaming/ack protocol: **keyset-paginated pull endpoints + a
tombstone log**, client-held cursors. This is Phase-2 work (doc 06) and is
useful to third-party clients beyond our app.

## 1. Prerequisites per model

Delta sync needs each synced model to answer "what changed since X?" and
"what was deleted since X?".

| Model | `last_modified` today | Work |
| --- | --- | --- |
| `Photo` | ✅ `auto_now`, indexed (`photo.py:111`) | none |
| `Person` | ❓ verify | add `last_modified = DateTimeField(auto_now=True, db_index=True)` if missing |
| `AlbumUser`, `AlbumAuto`, `AlbumThing`, `AlbumPlace`, `Tag` | ❓ verify | same |
| `User` (profile/sharing surface) | ❓ | same |

M2M changes (photos added/removed from an album, sharing changes) must bump
the parent row's `last_modified` — Django M2M writes don't touch the parent.
Use `m2m_changed` signals (or explicit `save(update_fields=["last_modified"])`
in the mutation views) for: `AlbumUser.photos`, `Photo.shared_to`,
`AlbumAuto.photos`. **Audit checklist item: every mutation endpoint that
touches a synced model must bump a `last_modified` somewhere.**

Note `Photo` is already soft-deleting (`removed`, `in_trashcan` flags with
`last_modified` bump) — photo trash/restore needs no tombstones. Tombstones
cover **hard** deletes only.

## 2. Tombstone log

```python
class DeletionLog(models.Model):
    entity = models.CharField(max_length=32, db_index=True)   # 'photo' | 'person' | 'album_user' | ...
    entity_id = models.CharField(max_length=64)
    owner = models.ForeignKey(User, on_delete=models.CASCADE)  # visibility scoping
    deleted_at = models.DateTimeField(auto_now_add=True, db_index=True)
```

- Written via `post_delete` signals on synced models (and explicitly in
  bulk-delete code paths that bypass signals — audit `delete_missing_photos`
  and friends, which use queryset `.delete()`; queryset deletes DO fire
  post_delete per instance unless `fast_delete` — verify in tests).
- **Visibility loss = deletion**: un-sharing a photo/album must emit a
  tombstone row for the un-shared user (their mirror must drop the row even
  though nothing was deleted server-side). This is the subtlest correctness
  point in the whole design — dedicated tests required.
- Pruning: rows older than 90 days are deleted by a scheduled job. Clients
  whose cursor predates the prune horizon get `410 cursor_expired` → full
  reseed (client behavior in doc 03 §3).

## 3. Delta endpoints

One endpoint per entity, uniform envelope, session-authenticated (JWT),
scoped to `owner=user OR shared_to=user`:

```
GET /api/sync/photos/?cursor=<b64(last_modified,id)>&page_size=1000
GET /api/sync/persons/?...
GET /api/sync/albums/user/?...      (+ auto, thing, place, tag)
GET /api/sync/sharing/?...

200 {
  "items": [ ...flat summary serializers... ],
  "tombstones": [ "id", ... ],
  "next_cursor": "...",     // null => caught up
  "total": 12345,           // only when cursor=0 (seed progress UI)
  "server_time": "..."
}
410 { "error": "cursor_expired" }   // cursor older than tombstone horizon
```

Implementation notes:

- **Keyset pagination**, never OFFSET: `WHERE (last_modified, id) > (:c1, :c2)
  ORDER BY last_modified, id LIMIT :n`. Needs the composite index
  `(last_modified, id)` on `Photo` (UUID tie-break — same trap as the
  dev-suite pagination fix in PR #1935).
- Tombstones are merged into the same response, filtered by
  `deleted_at > cursor.last_modified` and entity+owner scope.
- Photo summary serializer is **flat and cheap** (the `remote_photo` columns
  in doc 02 §1): no exif_json, no captions, no embeddings. Target ≤250 B/row;
  `select_related`/`values()` only — this endpoint must not N+1.
- `is_favorite` resolved server-side (`rating >= user.favorite_min_rating`).
- Album membership sync: `user_album` items embed
  `photo_ids: [...]` when the album row changed (albums are small;
  simpler than a separate membership feed). Auto albums likewise.
- Rate/size guard: `page_size` capped at 1000; endpoint exempt from any
  response-compression issues by streaming JSON (`StreamingHttpResponse`)
  only if profiling demands it — plain paginated JSON first.

## 4. What v1 deliberately skips (vs Immich)

- **Server-held per-session checkpoints/acks** — client holds its cursor.
  Cost: a lost client DB restarts from zero (acceptable: reseed is cheap).
  Revisit if partner/multi-user sharing sync gets complex.
- **JSONL streaming with typed event union** — paginated JSON per entity is
  simpler in Django and in the client, at the price of N requests instead of 1
  stream. Fine at LibrePhotos scale.
- **Backfill protocol** for newly-shared albums — newly visible rows simply
  appear with fresh `last_modified` (sharing bumps it, §1), so they flow
  through the normal delta.

Immich's code shows the cost of getting this wrong early (client-side
migration/reset tasks, v1/v2 entity dual-support). Version the envelope from
day one: `/api/sync/...` responses carry `"v": 1`; breaking changes bump it
and old clients reseed.

## 5. Support endpoints

- `GET /api/sync/counts/` → `{ photos: n, persons: n, ... }` per current user —
  drives the client integrity check (doc 03 §8). Cheap COUNT queries.
- Existing endpoints reused: `/api/exists/{hash}`, `/api/upload/`,
  auth/token endpoints, all detail/mutation endpoints. One extension:
  `/api/upload/complete/` accepts optional client metadata
  (`device_created_at`, `device_modified_at`) used as the timestamp fallback
  for photos without EXIF dates — resolves issue librephotos#614 (client half
  in doc 03 §5).

## 6. Testing

- Unit tests per endpoint in the existing backend test layout
  (`api/tests/`), runnable under the Windows harness + CI job from PR #1935:
  cursor iteration covers full table exactly once; tie-break correctness on
  equal timestamps; tombstone emission on delete, un-share, and bulk delete
  paths; 410 on pruned cursor; sharing visibility (user B sees shared photo
  appear and disappear).
- **Convergence property test**: apply an arbitrary scripted mutation sequence
  server-side, run a simulated client (pull loop) — client table must equal
  server visible-set at quiescence. This one test catches most protocol bugs.
- Fixture recorder: dump anonymized envelope samples used by the mobile
  contract tests (doc 01 §Testing) so both sides pin the same wire format.
