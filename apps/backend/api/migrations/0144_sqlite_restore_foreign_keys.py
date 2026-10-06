"""Restore what 0099's SQLite table rebuild dropped: foreign keys and more.

The SQLite path of ``0099_photo_uuid_primary_key`` (inlined into
``0001_squashed_0100``) moved every photo reference from ``image_hash`` to the
new UUID by recreating the fifteen tables that held one. It built each new
table from ``PRAGMA table_info`` -- names, types, NOT NULL, defaults -- and so
lost everything that listing does not carry. Three of those tables
(``api_person``, ``api_albumuser``, ``api_photostack``) have since been
recreated from their models by later migrations. The other twelve -- the six
album M2Ms, ``api_face``, ``api_photo_files``, ``api_photo_shared_to``,
``api_thumbnail``, ``api_photo_caption``, ``api_photo_search`` -- have been
running on every SQLite install, fresh ones included, without:

* any foreign key: not just ``photo_id`` but every one on those tables, so
  ``api_face.person_id``, the album side of the M2Ms, ``file_id`` and
  ``user_id`` included;
* ``AUTOINCREMENT`` on ``id``, so SQLite hands a deleted row's id to the next
  row inserted;
* ``NOT NULL`` on ``photo_id`` in the eight M2M tables;
* the ``JSON_VALID`` check on ``api_photo_caption.captions_json``.

Beyond not enforcing anything, that was a trap for the future: the first
migration to alter one of these tables makes Django's SQLite schema editor
rebuild it from the model, foreign keys included, and that editor runs
``PRAGMA foreign_key_check`` when it closes. Any row pointing at nothing would
have stopped that migration on user installs.

So this does that rebuild now, deliberately. For each ``api`` table the model
gives a foreign key its table does not have, it first settles the rows that
point at nothing -- the value is not in the target table, or it is NULL where
the model says NOT NULL -- the way the field's ``on_delete`` would have when
the target went: CASCADE deletes the row, through Django's collector so that
what depends on it follows its own rules (a person whose cover face goes gets
NULL); a nullable field is set to NULL. ``api_face.person_id`` is
DO_NOTHING, and Person's post_delete handler sets it to NULL too. Among the
rows removed this way are any whose photo was already gone when 0099 ran:
its mapping had no entry for them, so they still hold the old ``image_hash``,
which is not a UUID and crashes anything that loads the row. Then the table
is rebuilt from the model, which restores everything listed above along with
the indexes Django creates for it. 0099's extra ``*_photo_id_idx`` indexes go
with the old table; the same columns stay indexed by Django's own.

The rebuild copies each table before dropping the old one. On a synthetic
database with 1.6 million album links and 160,000 faces (933 MB) it took
about 30 seconds on a laptop, and the file grew by about 650 MB: SQLite keeps
the freed pages for later writes and only hands them back to the filesystem
on VACUUM. Installs short on disk need that much room.

It depends on ``0143_sqlite_photo_ids_hex``: until that has run, photo ids on
installs that ran 0099 with photos do not match ``api_photo.id``, and every
row pointing at such a photo would count as pointing at nothing.

SQLite only. 0099's PostgreSQL path dropped the photo foreign keys and added
them back, and left the rest alone. Tables that have all their foreign keys
are skipped, so running it again does nothing, and reversing does nothing
either: there is no reason to take the constraints away again.
"""

import copy

from django.db import migrations, models
from django.db.models import Exists, OuterRef, Q


def constrained_foreign_keys(model):
    return [
        field
        for field in model._meta.local_concrete_fields
        if field.remote_field and getattr(field, "db_constraint", False)
    ]


def missing_foreign_keys(model, connection):
    """The model's foreign keys that its table has no REFERENCES clause for."""
    with connection.cursor() as cursor:
        relations = connection.introspection.get_relations(cursor, model._meta.db_table)
    return [
        field
        for field in constrained_foreign_keys(model)
        if relations.get(field.column, (None, None))[1]
        != field.related_model._meta.db_table
    ]


def dangling_rows(model, field):
    """Rows whose *field* a foreign key would reject: it points at nothing."""
    target = field.related_model._base_manager.filter(
        **{field.target_field.attname: OuterRef(field.attname)}
    )
    points_nowhere = Q(**{f"{field.attname}__isnull": False}) & ~Exists(target)
    if not field.null:
        points_nowhere |= Q(**{f"{field.attname}__isnull": True})
    return model._base_manager.filter(points_nowhere)


def settle_dangling_rows(model, field):
    """Apply *field*'s on_delete to the rows whose target is already gone."""
    rows = dangling_rows(model, field)
    if field.remote_field.on_delete is models.CASCADE:
        # Load nothing but the primary key: a row whose photo was already
        # gone when 0099 ran still holds that photo's old image_hash, which
        # UUIDField cannot parse.
        rows.only(model._meta.pk.name).delete()
    elif field.null:
        rows.update(**{field.name: None})
    elif rows.exists():
        # None of the twelve tables has such a field; this is here for a
        # database whose schema drifted some other way.
        raise RuntimeError(
            f"Rows of {model._meta.db_table} have a {field.column} that "
            f"matches no row of {field.related_model._meta.db_table}. The "
            f"column is NOT NULL and does not cascade, so there is no safe "
            f"automatic repair: fix or delete those rows and run migrate again."
        )


def rebuild_from_model(schema_editor, model, field):
    """Recreate *model*'s table from the model definition.

    Done through the public alter_field: from *field* as the table has it --
    without a constraint -- to *field* as the model has it. SQLite cannot add
    a constraint in place, so the schema editor rebuilds the whole table from
    the model, every column, constraint and index of it, not only this one.
    """
    as_in_the_table = copy.copy(field)
    as_in_the_table.db_constraint = False
    schema_editor.alter_field(model, as_in_the_table, field)


def restore_foreign_keys(apps, schema_editor):
    connection = schema_editor.connection
    if connection.vendor != "sqlite":
        return

    for model in apps.get_models(include_auto_created=True):
        if (
            model._meta.app_label != "api"
            or not model._meta.managed
            or model._meta.proxy
        ):
            continue
        missing = missing_foreign_keys(model, connection)
        if not missing:
            continue
        for field in missing:
            settle_dangling_rows(model, field)
        rebuild_from_model(schema_editor, model, missing[0])


class Migration(migrations.Migration):
    dependencies = [
        ("api", "0143_sqlite_photo_ids_hex"),
    ]

    operations = [
        migrations.RunPython(restore_foreign_keys, migrations.RunPython.noop),
    ]
