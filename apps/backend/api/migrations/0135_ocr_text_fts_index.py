"""Add a functional GIN full-text index over PhotoOcr.text (Postgres only).

There is deliberately no ``SearchVectorField`` column: a stored vector column
would need a schema migration that the SQLite test settings cannot apply. The
query-time OCR full-text search in ``api.filters`` builds the tsvector on the
fly (``to_tsvector('simple', ...)``); this index makes that lookup fast on
Postgres. On every other backend (SQLite in CI) the OCR search degrades to a
substring match, so the index is unnecessary and this migration is a silent
no-op.

The index is created with raw SQL through a vendor-guarded ``RunPython``
operation so ``makemigrations --check`` stays clean and the migration applies
against SQLite (test DB creation) without error. ``state_operations`` is empty
because the index is not represented in Django's model state.
"""

from django.db import migrations

INDEX_NAME = "api_photo_ocr_text_fts"
TABLE_NAME = "api_photo_ocr"

CREATE_INDEX_SQL = (
    f"CREATE INDEX IF NOT EXISTS {INDEX_NAME} "
    f"ON {TABLE_NAME} USING gin(to_tsvector('simple', coalesce(text, '')))"
)
DROP_INDEX_SQL = f"DROP INDEX IF EXISTS {INDEX_NAME}"


def create_ocr_fts_index(apps, schema_editor):
    if schema_editor.connection.vendor != "postgresql":
        return
    schema_editor.execute(CREATE_INDEX_SQL)


def drop_ocr_fts_index(apps, schema_editor):
    if schema_editor.connection.vendor != "postgresql":
        return
    schema_editor.execute(DROP_INDEX_SQL)


class Migration(migrations.Migration):
    dependencies = [
        ("api", "0134_alter_longrunningjob_job_type"),
    ]

    operations = [
        migrations.RunPython(
            create_ocr_fts_index,
            drop_ocr_fts_index,
        ),
    ]
