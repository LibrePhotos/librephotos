"""Restore the ``(album_id, photo_id)`` unique constraints on the album M2M
tables (PostgreSQL), de-duplicating the rows that accumulated without them.

This is the second half of the repair ``0139_album_m2m_photo_id_indexes``
started. ``0099_photo_uuid_primary_key`` rewrote the ``photo_id`` column of
every album M2M table by dropping the constraints, swapping the column and
adding the foreign key back. 0139 put the plain ``photo_id`` indexes back; the
unique constraint Django creates over both columns of an auto-created through
table was never restored, and still is not on any install that ran 0099.

Losing it is not only a missing guard. Django *relies* on it. Adding to an
auto-created M2M goes through ``ManyRelatedManager._add_items``, which inserts
with ``ignore_conflicts=True`` (``related_descriptors.py``) precisely because
"the only possible collision is on the (source_id, target_id) tuple" -- and
where no listener is connected to ``m2m_changed`` it takes the fast path,
which skips the "which of these are already there" query altogether and leans
on the database to drop the repeats. ``ON CONFLICT DO NOTHING`` with nothing
to conflict against does not drop anything, so on PostgreSQL every such insert
of a pair that is already present appends another row. Five of these six
tables have no listener and take that path; only ``AlbumThing.photos`` has one.

The visible cost is small but real: a photo counted twice in an album, a cover
photo picked twice, and rows that every album query carries. The rows that
accumulate this way are exact duplicates of a pair whose meaning is set
membership, so removing them changes nothing an album can show.

Measured on a 158k-photo library that had been running without the constraints
since 0099: 54 duplicate pairs in ``api_albumplace_photos``, 3 in
``api_albumdate_photos``, 1 in ``api_albumthing_cover_photos``. Small, because
the application paths mostly remove before they add and the window is a
concurrent one -- but they only ever accumulate. ``api_albumthing_photos``,
the one table here whose ``m2m_changed`` has a listener and so keeps the
check-first path, has none in 1.59 million rows.

SQLite is unaffected, as it was in 0139: that path in 0099 recreates each
table and copies its index definitions across, so the unique index is still
there. Each table is therefore checked before it is touched, which also makes
this a no-op on PostgreSQL installs that added the constraint by hand.

Each table is read once to find its duplicates and once more to build the
index, under a lock that blocks writes to it while that happens. On that same
158k-photo library the whole migration took 4.7 seconds -- 2.8 de-duplicating,
1.9 building -- for 75 MB of index, and on a small library it is milliseconds
and tens of kilobytes. ``api_albumthing_photos`` is 85% of that time and 83%
of that size on its own, at 1.59 million rows. Migrations run before the
workers start serving, so it is not time a user waits, and the space is what
an install that never ran 0099 already carries: Django would have created
these indexes itself.

The constraint is created as a unique index rather than through ``ALTER TABLE
... ADD CONSTRAINT``: the two enforce the same thing here, and a unique index
is the form SQLite can create as well, so the same code path is the one the
tests exercise.

Reversing drops the indexes this migration created. It cannot bring the
duplicate rows back, which is the point of removing them.

Out of scope: 0099 also left ``photo_id`` nullable on these tables, where
Django would have it ``NOT NULL``. Tightening that means rewriting the table
on SQLite, and a unique index counts NULLs as distinct in any case, so it
belongs in its own change rather than being smuggled in here.
"""

from django.db import migrations

# (index name, table, album column). The other column is always ``photo_id``.
UNIQUE_INDEXES = [
    (
        "api_albumuser_photos_albumuser_id_photo_id_uniq",
        "api_albumuser_photos",
        "albumuser_id",
    ),
    (
        "api_albumthing_photos_albumthing_id_photo_id_uniq",
        "api_albumthing_photos",
        "albumthing_id",
    ),
    (
        "api_albumthing_cover_photos_albumthing_id_photo_id_uniq",
        "api_albumthing_cover_photos",
        "albumthing_id",
    ),
    (
        "api_albumplace_photos_albumplace_id_photo_id_uniq",
        "api_albumplace_photos",
        "albumplace_id",
    ),
    (
        "api_albumdate_photos_albumdate_id_photo_id_uniq",
        "api_albumdate_photos",
        "albumdate_id",
    ),
    (
        "api_albumauto_photos_albumauto_id_photo_id_uniq",
        "api_albumauto_photos",
        "albumauto_id",
    ),
]


def has_unique_constraint(connection, table, album_column):
    """Whether *table* already enforces uniqueness over the two link columns.

    Checked by column set rather than by name: the constraint we would add is
    only missing where 0099's PostgreSQL path dropped Django's, and Django's
    carries a generated name we cannot predict.
    """
    with connection.cursor() as cursor:
        constraints = connection.introspection.get_constraints(cursor, table)
    wanted = {album_column, "photo_id"}
    return any(
        details.get("unique") and set(details.get("columns") or ()) == wanted
        for details in constraints.values()
    )


def delete_duplicate_rows(schema_editor, table, album_column):
    """Keep the oldest row of each duplicated pair and delete the rest.

    One statement, and the window function is understood by both backends, so
    the de-duplication a PostgreSQL install needs is also what the tests run.
    """
    schema_editor.execute(
        f"""
        DELETE FROM "{table}"
        WHERE "id" IN (
            SELECT "id" FROM (
                SELECT "id", ROW_NUMBER() OVER (
                    PARTITION BY "{album_column}", "photo_id" ORDER BY "id"
                ) AS row_number
                FROM "{table}"
            ) duplicates
            WHERE duplicates.row_number > 1
        )
        """
    )


def add_unique_indexes(apps, schema_editor):
    connection = schema_editor.connection
    for index_name, table, album_column in UNIQUE_INDEXES:
        if has_unique_constraint(connection, table, album_column):
            continue
        delete_duplicate_rows(schema_editor, table, album_column)
        schema_editor.execute(
            f'CREATE UNIQUE INDEX "{index_name}" '
            f'ON "{table}" ("{album_column}", "photo_id")'
        )


def drop_unique_indexes(apps, schema_editor):
    for index_name, _, _ in UNIQUE_INDEXES:
        schema_editor.execute(f'DROP INDEX IF EXISTS "{index_name}"')


class Migration(migrations.Migration):
    dependencies = [
        ("api", "0139_album_m2m_photo_id_indexes"),
    ]

    operations = [
        migrations.RunPython(add_unique_indexes, drop_unique_indexes),
    ]
