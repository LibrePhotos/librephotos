"""Accent-insensitive search (#659): add ``PhotoSearch.search_folded`` and fill it.

The column holds the photo's search captions and location without case or
diacritics, so a search for "Zurich" finds "Zürich". The app keeps it in step
from now on; this fills it for the rows that exist.

The backfill reads ``BATCH_SIZE`` rows at a time, keyed on the primary key so
no cursor stays open while it writes (SQLite cannot), and writes each batch
with one ``executemany`` UPDATE: 100,000 rows take about 6 seconds on SQLite,
where ``bulk_update``'s CASE statements took over a minute. That is short
enough to run here rather than in a job that would leave search
accent-sensitive until it finished.

``fold`` is a frozen copy of ``api.models.photo_search.fold`` as of this
migration, so a later change there does not change what this migration did;
``api/tests/migrations/test_migration_0162_photo_search_folded.py`` checks
that the two agree today.
"""

import re
import unicodedata

from django.apps.registry import Apps
from django.db import migrations, models
from django.db.backends.base.schema import BaseDatabaseSchemaEditor

BATCH_SIZE = 2000

_DIACRITICS = re.compile(
    "[\u0300-\u036f\u1ab0-\u1aff\u1dc0-\u1dff\u20d0-\u20ff\ufe20-\ufe2f]"
)
_UNSPLIT_LETTERS = str.maketrans(
    {"ø": "o", "ł": "l", "đ": "d", "ħ": "h", "ı": "i", "ŧ": "t", "æ": "ae", "œ": "oe"}
)


def fold(text: str) -> str:
    decomposed = unicodedata.normalize("NFKD", text.casefold())
    stripped = _DIACRITICS.sub("", decomposed).translate(_UNSPLIT_LETTERS)
    return unicodedata.normalize("NFC", stripped)


def fill_search_folded(apps: Apps, schema_editor: BaseDatabaseSchemaEditor) -> None:
    PhotoSearch = apps.get_model("api", "PhotoSearch")
    connection = schema_editor.connection
    quote = connection.ops.quote_name
    pk_field = PhotoSearch._meta.pk
    update = (
        f"UPDATE {quote(PhotoSearch._meta.db_table)} SET {quote('search_folded')} = %s"
        f" WHERE {quote(pk_field.column)} = %s"
    )
    rows = PhotoSearch.objects.using(connection.alias).order_by("pk")
    last_pk = None
    while True:
        batch = rows if last_pk is None else rows.filter(pk__gt=last_pk)
        values = list(
            batch.values_list("pk", "search_captions", "search_location")[:BATCH_SIZE]
        )
        if not values:
            return
        last_pk = values[-1][0]
        params = [
            (
                fold(" ".join(part for part in (captions, location) if part)),
                pk_field.get_db_prep_value(pk, connection),
            )
            for pk, captions, location in values
            if captions or location
        ]
        with connection.cursor() as cursor:
            cursor.executemany(update, params)


class Migration(migrations.Migration):
    dependencies = [
        ("api", "0161_photo_metadata_read_at"),
    ]

    operations = [
        migrations.AddField(
            model_name="photosearch",
            name="search_folded",
            field=models.TextField(blank=True, default=""),
        ),
        # Backwards, RemoveField drops the column with its contents.
        migrations.RunPython(fill_search_folded, migrations.RunPython.noop),
    ]
