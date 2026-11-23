---
title: "SQLite planner statistics"
description: "When LibrePhotos runs ANALYZE on SQLite, and why the face count needs it."
sidebar_position: 6
---

<Since version="1.7.0" /> On SQLite, LibrePhotos keeps the query planner's statistics (the
`sqlite_stat1` table that `ANALYZE` writes) current by itself. PostgreSQL needs nothing from
LibrePhotos: its autovacuum analyzes tables as they change.

## Why it matters

Without statistics SQLite guesses that every index narrows a lookup to about ten rows, so it cannot
tell `api_photo.removed` (almost every row is `false`) from `api_face.person_id`. The count behind
`Person.face_count` (`Person._calculate_face_count`, run for every saved face that has a person) then
starts from `api_photo` and scans the person's faces once per photo. On a library of 100,000 photos
that is over 30 seconds for a person with 11,000 faces and still 1–2 seconds for a person with one
face ([#3071](https://github.com/LibrePhotos/librephotos/issues/3071)). After a full `ANALYZE`, which
takes about half a second on that 1.8 GB database, the count starts from the person's faces and
takes milliseconds.

Sampled statistics are not enough. `PRAGMA optimize` (which samples 400 rows per index on SQLite
3.46 and newer) and `PRAGMA analysis_limit=1000` both produced a plan that walks every photo, about
4.5 seconds per call for every person. `apps/backend/api/runtime/planner_stats.py` therefore always
runs a full `ANALYZE`.

## When it runs

`refresh_planner_stats()` counts the rows of the tables that grow with the library (photos, files,
thumbnails, faces, people, clusters, the albums and their many-to-many tables, listed in
`WATCHED_MODELS`). It compares each count with the row count the last `ANALYZE` stored. A table is
stale once it changed by at least 500 rows and by at least 10 % since then; a table that has never
been analyzed is stale once it has 500 rows. Only then does it run `ANALYZE` over the whole
database. Otherwise the check costs one `count(*)` per watched table.

It is called:

- after `migrate` (a `post_migrate` handler), which every start of the containers and of the Windows
  standalone build runs. An upgraded install with a library gets statistics on its first start. A
  new install has empty tables, and `ANALYZE` writes nothing for an empty table, so this does nothing
  there;
- when a job that queues its work as tasks (the photo scan, uploads, tags, captions, geolocation,
  OCR) reaches its target (`finish_job_if_complete`), before its follow-up jobs are queued. After a
  first scan, the face scan that follows starts with statistics for the photos, which is enough for
  the fast plan even while `api_face` is still empty;
- by Scan Faces when it starts, every 5,000 photos while it runs, and after its clustering.

A connection reads the statistics when it opens and keeps them. Web requests and short tasks open a
new connection (`CONN_MAX_AGE` is 0 on SQLite), but Scan Faces runs as one long task, so its checks
pass `reload=True`: when nothing is stale, they run `ANALYZE sqlite_schema`, which only reloads the
statistics another process may have written (a few milliseconds).

A failed refresh (for example a database locked for longer than the busy timeout) is logged as a
warning and the job goes on.

## Checking a query plan

`api/tests/infra/test_sqlite_planner_stats.py` asserts that, once analyzed, the face count starts
from `api_face` by `person_id`. To see the plan of any query:

```python
from django.db import connection

sql, params = queryset.query.sql_with_params()
with connection.cursor() as cursor:
    cursor.execute("EXPLAIN QUERY PLAN " + sql, params)
    print(cursor.fetchall())
```

A plan read on a test database with a few rows tells little: build enough rows for the planner to
choose (the test above uses 2,000 photos and 3,000 faces) and compare the plan before and after
`refresh_planner_stats()`.
