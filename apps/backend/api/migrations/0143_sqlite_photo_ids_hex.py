"""Store the photo ids 0099 wrote on SQLite in the form Django reads.

``0099_photo_uuid_primary_key`` (now inside ``0001_squashed_0100``) gave every
photo a UUID primary key. Its SQLite path generated them with
``str(uuid.uuid4())`` and stored that -- 36 characters with dashes -- in
``api_photo.id`` and in every column pointing at the photo. Django's
``UUIDField`` has no native column type on SQLite: it stores and compares
``uuid.hex``, 32 characters without dashes. Reading parses either form, so
the photos kept showing up in lists, but on every SQLite install that had
photos when it ran 0099:

* ``Photo.objects.get(pk=...)`` and every other lookup by id miss them, and
  so does every lookup of a row that points at them (faces, thumbnail,
  caption, metadata, ...).
* Every row Django has written for one of them since holds the hex form.
  Where the column has a foreign key, that write fails on commit with
  "FOREIGN KEY constraint failed". Where 0099's table rebuild left none -- the
  album M2Ms, faces, thumbnails, captions, search, files, shared_to -- it
  succeeds and the row joins to nothing.

This rewrites every dashed value to ``replace(value, '-', '')`` in
``api_photo.id`` and in each column that stores a photo id. Those come from
the migration state (every foreign key and one-to-one to Photo, including the
auto-created M2M tables) and from the database (every column that
``REFERENCES api_photo(id)``). Introspection alone is not enough: the twelve
tables 0099 rebuilt without a REFERENCES clause only show up in the state.

Where a hex row already sits next to a dashed one under a unique constraint,
the hex one wins and the dashed one is deleted. That happens where Django went
looking for the old row by the hex id, found nothing and wrote a new one: a
second thumbnail, caption or search row, or an album link added again. The
hex row is the one the app has read and updated since the upgrade; for the
M2M tables the two are the same pair anyway.

``api_deletionlog.entity_id`` is deliberately left alone. Tombstones store
``str(pk)`` for every photo, dashed by design, because that is the form the
API serialises and the sync client compares against.

SQLite only: PostgreSQL has a native uuid column and was never affected.
Running it again finds nothing to rewrite. Reversing does nothing, because
putting the dashed ids back would only break the photos again.
"""

from django.db import migrations

# str(uuid.uuid4()) as a LIKE pattern: "_" is any one character, "-" itself.
DASHED_UUID = "________-____-____-____-____________"


def photo_id_columns(apps, connection):
    """(table, column) of every column that stores a photo's primary key."""
    Photo = apps.get_model("api", "Photo")
    photo_pk = (Photo._meta.db_table, Photo._meta.pk.column)
    columns = {photo_pk}
    for model in apps.get_models(include_auto_created=True):
        for field in model._meta.local_fields:
            if (
                field.is_relation
                and field.related_model is Photo
                and field.target_field.primary_key
            ):
                columns.add((model._meta.db_table, field.column))
    with connection.cursor() as cursor:
        for table in connection.introspection.table_names(cursor):
            relations = connection.introspection.get_relations(cursor, table)
            for column, (target_column, target_table) in relations.items():
                if (target_table, target_column) == photo_pk:
                    columns.add((table, column))
    return columns


def rewrite_to_hex(cursor, statement, table, column):
    """Run *statement* ("UPDATE" or "UPDATE OR IGNORE") over the dashed values."""
    cursor.execute(
        f'{statement} "{table}" SET "{column}" = lower(replace("{column}", %s, %s)) '
        f'WHERE "{column}" LIKE %s',
        ["-", "", DASHED_UUID],
    )


def rewrite_dashed_photo_ids(apps, schema_editor):
    connection = schema_editor.connection
    if connection.vendor != "sqlite":
        return

    Photo = apps.get_model("api", "Photo")
    photo_pk = (Photo._meta.db_table, Photo._meta.pk.column)
    columns = sorted(photo_id_columns(apps, connection))

    with connection.cursor() as cursor:
        tables = set(connection.introspection.table_names(cursor))
        existing = {
            table: {
                column.name
                for column in connection.introspection.get_table_description(
                    cursor, table
                )
            }
            for table in {table for table, _ in columns} & tables
        }

        # migrate runs this inside a transaction, where SQLite ignores the
        # pragma; there the schema editor has already switched enforcement off
        # before BEGIN, and runs PRAGMA foreign_key_check when it closes, so a
        # column missed here still fails the migration.
        cursor.execute("PRAGMA foreign_keys")
        enforced = cursor.fetchone()[0]
        cursor.execute("PRAGMA foreign_keys = OFF")
        try:
            for table, column in columns:
                if column not in existing.get(table, ()):
                    continue
                if (table, column) == photo_pk:
                    # Two photos cannot share an id: let a clash fail loudly
                    # rather than skip a photo.
                    rewrite_to_hex(cursor, "UPDATE", table, column)
                    continue
                rewrite_to_hex(cursor, "UPDATE OR IGNORE", table, column)
                # What is still dashed was skipped because its hex twin exists.
                cursor.execute(
                    f'DELETE FROM "{table}" WHERE "{column}" LIKE %s',
                    [DASHED_UUID],
                )
        finally:
            if enforced:
                cursor.execute("PRAGMA foreign_keys = ON")


class Migration(migrations.Migration):
    dependencies = [
        ("api", "0142_deletionlog_albumauto_last_modified_and_more"),
    ]

    operations = [
        migrations.RunPython(rewrite_dashed_photo_ids, migrations.RunPython.noop),
    ]
