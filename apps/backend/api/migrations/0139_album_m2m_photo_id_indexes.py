"""Restore the ``photo_id`` indexes on the album M2M tables (PostgreSQL).

``0099_photo_uuid_primary_key`` rewrote every ``photo_id`` column from the old
``image_hash`` string to a UUID. Its PostgreSQL path did that by dropping the
foreign keys, swapping the columns and adding the foreign keys back -- and a
foreign key does not carry an index with it, so the indexes Django had created
alongside the original constraints had to be recreated by hand. That is what
``api_face``, ``api_photo_shared_to``, ``api_photo_files``, ``api_person``,
``api_albumuser`` and ``api_photostack`` got.

The six album M2M tables were missed, and nothing has put their indexes back
since: they are auto-created through tables, so they never appear in Django's
migration state and ``makemigrations`` cannot notice the gap. Every other
photo-referencing column in the schema is indexed; these six are the only ones
that are not.

SQLite is unaffected -- that path in 0099 recreates each table and copies its
index definitions across, so a SQLite database still has the index Django
made. This migration therefore skips any table that already has one, under
whatever name, which also makes it a no-op on installs that added the index by
hand.

Only the photo side was lost. The album side (``albumdate_id`` and its
siblings) kept its index, which is why listing the photos of an album is fast
while going the other way -- "which albums is this photo in" -- is not. That
direction is not rare: ``Photo._geolocate`` calls ``_find_album_place`` for
every photo it processes, so a geolocation pass over a large library scans the
album-place table once per photo. The same unindexed columns are what
PostgreSQL searches to satisfy ``ON DELETE CASCADE`` when a photo is deleted.

The indexes are built non-concurrently, taking a lock that blocks writes to
these tables while they are created. Measured on a 158k-photo library that was
1.2 seconds in total, the bulk of it the 1.6M-row ``api_albumthing_photos``,
for about 24 MB of index; on a small library it is milliseconds and tens of
kilobytes. Migrations run before the workers start serving, so this is not
time a user waits.

This does not restore the ``(album_id, photo_id)`` unique constraints that
0099 also dropped on PostgreSQL. Databases that have run without them can
already contain duplicate pairs, so putting those back needs a de-duplication
step first and belongs in its own migration.
"""

from django.db import migrations

# (index name, table). The indexed column is always ``photo_id``, and the
# names follow the convention 0099 used for the tables it did recreate.
INDEXES = [
    ("api_albumuser_photos_photo_id_idx", "api_albumuser_photos"),
    ("api_albumthing_photos_photo_id_idx", "api_albumthing_photos"),
    ("api_albumplace_photos_photo_id_idx", "api_albumplace_photos"),
    ("api_albumdate_photos_photo_id_idx", "api_albumdate_photos"),
    ("api_albumauto_photos_photo_id_idx", "api_albumauto_photos"),
    (
        "api_albumthing_cover_photos_photo_id_idx",
        "api_albumthing_cover_photos",
    ),
]


def has_photo_id_index(connection, table):
    """Whether *table* already has an index led by ``photo_id``.

    Checked through introspection rather than by name: the index we would add
    is only missing where 0099's PostgreSQL path dropped Django's, and that
    one carries a different, generated name.
    """
    with connection.cursor() as cursor:
        constraints = connection.introspection.get_constraints(cursor, table)
    return any(
        details.get("index")
        and details.get("columns")
        and details["columns"][0] == "photo_id"
        for details in constraints.values()
    )


def create_indexes(apps, schema_editor):
    connection = schema_editor.connection
    for index_name, table in INDEXES:
        if has_photo_id_index(connection, table):
            continue
        schema_editor.execute(f'CREATE INDEX "{index_name}" ON "{table}" ("photo_id")')


def drop_indexes(apps, schema_editor):
    for index_name, _ in INDEXES:
        schema_editor.execute(f'DROP INDEX IF EXISTS "{index_name}"')


class Migration(migrations.Migration):
    dependencies = [
        ("api", "0138_onnx_only_ml_models"),
    ]

    operations = [
        migrations.RunPython(create_indexes, drop_indexes),
    ]
