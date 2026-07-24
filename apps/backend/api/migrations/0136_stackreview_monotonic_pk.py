"""Give StackReview a monotonic primary key so its ordering is a total order.

Meta.ordering was ["-created_at"]. created_at is auto_now_add, so two rows
written in the same clock tick hold the same value, and with a random uuid4 pk
there was nothing to break the tie: the database could return such rows in
either order, which lets one move between pages of an offset-paginated response
and be served twice or skipped.

The tiebreak has to follow insertion order to be chronologically honest, and
Django only allows an auto-incrementing column as the primary key (fields.E100,
"AutoFields must set primary_key=True"), so the monotonic column cannot be a
separate "seq" field - it has to be the pk. The uuid4 is kept as `uuid`, a
unique non-pk column, so rows stay externally nameable by the same value they
were nameable by before and no sequential counter leaks into the API.

Written out by hand rather than taken from makemigrations, which generates a
bare AlterField from UUIDField to BigAutoField. That is silently destructive:
Postgres cannot cast uuid to bigint at all, and SQLite's table rebuild would
coerce the uuid strings to integers. The same applies to adding `uuid` unique
in one step - AddField evaluates a default once and writes that single value to
every row, so the unique constraint would fail on any table with two rows.

Reversing this migration is only sound on an empty table: the reverse of the pk
swap re-adds a UUIDField pk, and AddField would again write one shared default
into every row.
"""

import uuid

from django.db import migrations, models
from django.db.models import F


def copy_pk_to_uuid(apps, schema_editor):
    """Preserve each row's existing pk as its external identifier."""
    StackReview = apps.get_model("api", "StackReview")
    StackReview.objects.update(uuid=F("id"))


class Migration(migrations.Migration):
    dependencies = [
        ("api", "0135_ocr_text_fts_index"),
    ]

    operations = [
        # Nullable and non-unique first, so the column can exist before it has
        # per-row values.
        migrations.AddField(
            model_name="stackreview",
            name="uuid",
            field=models.UUIDField(default=uuid.uuid4, editable=False, null=True),
        ),
        migrations.RunPython(copy_pk_to_uuid, migrations.RunPython.noop),
        # Every row now holds its old pk, so unique and NOT NULL can be applied.
        migrations.AlterField(
            model_name="stackreview",
            name="uuid",
            field=models.UUIDField(default=uuid.uuid4, editable=False, unique=True),
        ),
        # Swap the pk as a drop and an add rather than an AlterField: there is
        # no cast from uuid to bigint, and the new values have to come from the
        # sequence, not from the old column.
        migrations.RemoveField(
            model_name="stackreview",
            name="id",
        ),
        migrations.AddField(
            model_name="stackreview",
            name="id",
            field=models.BigAutoField(primary_key=True, serialize=False),
        ),
        migrations.AlterModelOptions(
            name="stackreview",
            options={
                "ordering": ["-created_at", "-id"],
                "verbose_name": "Stack Review",
                "verbose_name_plural": "Stack Reviews",
            },
        ),
    ]
