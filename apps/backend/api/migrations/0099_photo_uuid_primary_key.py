# Generated migration for Photo UUID primary key
# This migration changes Photo from using image_hash as PK to using UUID as PK
#
# Supports both PostgreSQL (raw SQL) and SQLite (table recreation pattern).
#
# ============================================================================
# CRITICAL WARNING: THIS MIGRATION IS NOT REVERSIBLE
# ============================================================================
# This migration fundamentally changes the Photo primary key from image_hash
# (a content-based hash) to UUID (a random identifier). Reversing this would
# require regenerating the original image_hash values from file content, which
# is not possible without access to the original photo files and significant
# processing time.
#
# BEFORE RUNNING THIS MIGRATION:
# 1. Create a FULL DATABASE BACKUP: pg_dump -U your_user your_db > backup.sql
# 2. Test the migration on a copy of your production database first
# 3. Plan for downtime - this migration may take significant time on large DBs
# 4. Ensure you have enough disk space for the migration operations
#
# TO ROLLBACK (if needed):
# 1. Stop the application
# 2. Restore from your pre-migration database backup
# 3. Fake-migrate back: python manage.py migrate api 0098 --fake
# ============================================================================

import uuid
from django.db import migrations, models


# ============================================================================
# PostgreSQL raw SQL
# ============================================================================

POSTGRESQL_FORWARD_SQL = """
-- Step 1: Add UUID column to api_photo
ALTER TABLE api_photo ADD COLUMN id UUID DEFAULT gen_random_uuid();
UPDATE api_photo SET id = gen_random_uuid() WHERE id IS NULL;
ALTER TABLE api_photo ALTER COLUMN id SET NOT NULL;

-- Step 2: Create a mapping table for old hash -> new UUID
CREATE TEMP TABLE photo_id_mapping AS
SELECT image_hash, id FROM api_photo;
CREATE INDEX ON photo_id_mapping(image_hash);

-- Step 3: Add new UUID columns to all related tables

-- api_face
ALTER TABLE api_face ADD COLUMN photo_id_new UUID;
UPDATE api_face f SET photo_id_new = m.id
FROM photo_id_mapping m WHERE f.photo_id = m.image_hash;

-- api_photo_shared_to (M2M through table)
ALTER TABLE api_photo_shared_to ADD COLUMN photo_id_new UUID;
UPDATE api_photo_shared_to t SET photo_id_new = m.id
FROM photo_id_mapping m WHERE t.photo_id = m.image_hash;

-- api_photo_files (M2M through table)
ALTER TABLE api_photo_files ADD COLUMN photo_id_new UUID;
UPDATE api_photo_files t SET photo_id_new = m.id
FROM photo_id_mapping m WHERE t.photo_id = m.image_hash;

-- api_albumuser_photos (M2M through table)
ALTER TABLE api_albumuser_photos ADD COLUMN photo_id_new UUID;
UPDATE api_albumuser_photos t SET photo_id_new = m.id
FROM photo_id_mapping m WHERE t.photo_id = m.image_hash;

-- api_albumthing_photos (M2M through table)
ALTER TABLE api_albumthing_photos ADD COLUMN photo_id_new UUID;
UPDATE api_albumthing_photos t SET photo_id_new = m.id
FROM photo_id_mapping m WHERE t.photo_id = m.image_hash;

-- api_albumplace_photos (M2M through table)
ALTER TABLE api_albumplace_photos ADD COLUMN photo_id_new UUID;
UPDATE api_albumplace_photos t SET photo_id_new = m.id
FROM photo_id_mapping m WHERE t.photo_id = m.image_hash;

-- api_albumdate_photos (M2M through table)
ALTER TABLE api_albumdate_photos ADD COLUMN photo_id_new UUID;
UPDATE api_albumdate_photos t SET photo_id_new = m.id
FROM photo_id_mapping m WHERE t.photo_id = m.image_hash;

-- api_albumauto_photos (M2M through table)
ALTER TABLE api_albumauto_photos ADD COLUMN photo_id_new UUID;
UPDATE api_albumauto_photos t SET photo_id_new = m.id
FROM photo_id_mapping m WHERE t.photo_id = m.image_hash;

-- api_person (cover_photo_id)
ALTER TABLE api_person ADD COLUMN cover_photo_id_new UUID;
UPDATE api_person p SET cover_photo_id_new = m.id
FROM photo_id_mapping m WHERE p.cover_photo_id = m.image_hash;

-- api_albumuser (cover_photo_id)
ALTER TABLE api_albumuser ADD COLUMN cover_photo_id_new UUID;
UPDATE api_albumuser a SET cover_photo_id_new = m.id
FROM photo_id_mapping m WHERE a.cover_photo_id = m.image_hash;

-- api_albumthing_cover_photos (M2M through table for cover photos)
ALTER TABLE api_albumthing_cover_photos ADD COLUMN photo_id_new UUID;
UPDATE api_albumthing_cover_photos t SET photo_id_new = m.id
FROM photo_id_mapping m WHERE t.photo_id = m.image_hash;

-- api_thumbnail (OneToOne with PK)
ALTER TABLE api_thumbnail ADD COLUMN photo_id_new UUID;
UPDATE api_thumbnail t SET photo_id_new = m.id
FROM photo_id_mapping m WHERE t.photo_id = m.image_hash;

-- api_photo_caption (OneToOne with PK)
ALTER TABLE api_photo_caption ADD COLUMN photo_id_new UUID;
UPDATE api_photo_caption t SET photo_id_new = m.id
FROM photo_id_mapping m WHERE t.photo_id = m.image_hash;

-- api_photo_search (OneToOne with PK)
ALTER TABLE api_photo_search ADD COLUMN photo_id_new UUID;
UPDATE api_photo_search t SET photo_id_new = m.id
FROM photo_id_mapping m WHERE t.photo_id = m.image_hash;

-- api_photostack (primary_photo_id)
ALTER TABLE api_photostack ADD COLUMN primary_photo_id_new UUID;
UPDATE api_photostack s SET primary_photo_id_new = m.id
FROM photo_id_mapping m WHERE s.primary_photo_id = m.image_hash;

-- Step 4: Drop all FK constraints
ALTER TABLE api_face DROP CONSTRAINT IF EXISTS api_face_photo_id_6f997226_fk_api_photo_image_hash;
ALTER TABLE api_photo_shared_to DROP CONSTRAINT IF EXISTS api_photo_shared_to_photo_id_852923c7_fk_api_photo_image_hash;
ALTER TABLE api_photo_files DROP CONSTRAINT IF EXISTS api_photo_files_photo_id_f4365127_fk_api_photo_image_hash;
ALTER TABLE api_albumuser_photos DROP CONSTRAINT IF EXISTS api_albumuser_photos_photo_id_b9df1b14_fk_api_photo_image_hash;
ALTER TABLE api_albumthing_photos DROP CONSTRAINT IF EXISTS api_albumthing_photos_photo_id_d0832fc3_fk_api_photo_image_hash;
ALTER TABLE api_albumplace_photos DROP CONSTRAINT IF EXISTS api_albumplace_photos_photo_id_8fd88190_fk_api_photo_image_hash;
ALTER TABLE api_albumdate_photos DROP CONSTRAINT IF EXISTS api_albumdate_photos_photo_id_26095959_fk_api_photo_image_hash;
ALTER TABLE api_albumauto_photos DROP CONSTRAINT IF EXISTS api_albumauto_photos_photo_id_3320c2f0_fk_api_photo_image_hash;
ALTER TABLE api_person DROP CONSTRAINT IF EXISTS api_person_cover_photo_id_e0d8a6ab_fk_api_photo_image_hash;
ALTER TABLE api_albumuser DROP CONSTRAINT IF EXISTS api_albumuser_cover_photo_id_69b304ac_fk_api_photo_image_hash;
ALTER TABLE api_albumthing_cover_photos DROP CONSTRAINT IF EXISTS api_albumthing_cover_photo_id_ae113997_fk_api_photo;
ALTER TABLE api_thumbnail DROP CONSTRAINT IF EXISTS api_thumbnail_photo_id_484afcd0_fk_api_photo_image_hash;
ALTER TABLE api_photo_caption DROP CONSTRAINT IF EXISTS api_photo_caption_photo_id_363f8856_fk_api_photo_image_hash;
ALTER TABLE api_photo_search DROP CONSTRAINT IF EXISTS api_photo_search_photo_id_b4055a77_fk_api_photo_image_hash;
ALTER TABLE api_photostack DROP CONSTRAINT IF EXISTS api_photostack_primary_photo_id_a2e9fc96_fk_api_photo;

-- Step 5: Drop PKs on related tables that use photo as PK
ALTER TABLE api_thumbnail DROP CONSTRAINT IF EXISTS api_thumbnail_pkey;
ALTER TABLE api_photo_caption DROP CONSTRAINT IF EXISTS api_photo_caption_pkey;
ALTER TABLE api_photo_search DROP CONSTRAINT IF EXISTS api_photo_search_pkey;

-- Step 6: Drop old PK on api_photo, add new one
ALTER TABLE api_photo DROP CONSTRAINT api_photo_pkey;
ALTER TABLE api_photo ADD PRIMARY KEY (id);

-- Step 7: Add unique constraint on image_hash (for deduplication)
CREATE UNIQUE INDEX api_photo_image_hash_unique ON api_photo(image_hash);

-- Step 8: Drop old FK columns, rename new ones

ALTER TABLE api_face DROP COLUMN photo_id;
ALTER TABLE api_face RENAME COLUMN photo_id_new TO photo_id;

ALTER TABLE api_photo_shared_to DROP COLUMN photo_id;
ALTER TABLE api_photo_shared_to RENAME COLUMN photo_id_new TO photo_id;

ALTER TABLE api_photo_files DROP COLUMN photo_id;
ALTER TABLE api_photo_files RENAME COLUMN photo_id_new TO photo_id;

ALTER TABLE api_albumuser_photos DROP COLUMN photo_id;
ALTER TABLE api_albumuser_photos RENAME COLUMN photo_id_new TO photo_id;

ALTER TABLE api_albumthing_photos DROP COLUMN photo_id;
ALTER TABLE api_albumthing_photos RENAME COLUMN photo_id_new TO photo_id;

ALTER TABLE api_albumplace_photos DROP COLUMN photo_id;
ALTER TABLE api_albumplace_photos RENAME COLUMN photo_id_new TO photo_id;

ALTER TABLE api_albumdate_photos DROP COLUMN photo_id;
ALTER TABLE api_albumdate_photos RENAME COLUMN photo_id_new TO photo_id;

ALTER TABLE api_albumauto_photos DROP COLUMN photo_id;
ALTER TABLE api_albumauto_photos RENAME COLUMN photo_id_new TO photo_id;

ALTER TABLE api_person DROP COLUMN cover_photo_id;
ALTER TABLE api_person RENAME COLUMN cover_photo_id_new TO cover_photo_id;

ALTER TABLE api_albumuser DROP COLUMN cover_photo_id;
ALTER TABLE api_albumuser RENAME COLUMN cover_photo_id_new TO cover_photo_id;

ALTER TABLE api_albumthing_cover_photos DROP COLUMN photo_id;
ALTER TABLE api_albumthing_cover_photos RENAME COLUMN photo_id_new TO photo_id;

ALTER TABLE api_thumbnail DROP COLUMN photo_id;
ALTER TABLE api_thumbnail RENAME COLUMN photo_id_new TO photo_id;
ALTER TABLE api_thumbnail ALTER COLUMN photo_id SET NOT NULL;
ALTER TABLE api_thumbnail ADD PRIMARY KEY (photo_id);

ALTER TABLE api_photo_caption DROP COLUMN photo_id;
ALTER TABLE api_photo_caption RENAME COLUMN photo_id_new TO photo_id;
ALTER TABLE api_photo_caption ALTER COLUMN photo_id SET NOT NULL;
ALTER TABLE api_photo_caption ADD PRIMARY KEY (photo_id);

ALTER TABLE api_photo_search DROP COLUMN photo_id;
ALTER TABLE api_photo_search RENAME COLUMN photo_id_new TO photo_id;
ALTER TABLE api_photo_search ALTER COLUMN photo_id SET NOT NULL;
ALTER TABLE api_photo_search ADD PRIMARY KEY (photo_id);

ALTER TABLE api_photostack DROP COLUMN primary_photo_id;
ALTER TABLE api_photostack RENAME COLUMN primary_photo_id_new TO primary_photo_id;

-- Step 9: Recreate all FK constraints with new UUID type
ALTER TABLE api_face ADD CONSTRAINT api_face_photo_id_fk_api_photo
    FOREIGN KEY (photo_id) REFERENCES api_photo(id) ON DELETE CASCADE;

ALTER TABLE api_photo_shared_to ADD CONSTRAINT api_photo_shared_to_photo_id_fk
    FOREIGN KEY (photo_id) REFERENCES api_photo(id) ON DELETE CASCADE;

ALTER TABLE api_photo_files ADD CONSTRAINT api_photo_files_photo_id_fk
    FOREIGN KEY (photo_id) REFERENCES api_photo(id) ON DELETE CASCADE;

ALTER TABLE api_albumuser_photos ADD CONSTRAINT api_albumuser_photos_photo_id_fk
    FOREIGN KEY (photo_id) REFERENCES api_photo(id) ON DELETE CASCADE;

ALTER TABLE api_albumthing_photos ADD CONSTRAINT api_albumthing_photos_photo_id_fk
    FOREIGN KEY (photo_id) REFERENCES api_photo(id) ON DELETE CASCADE;

ALTER TABLE api_albumplace_photos ADD CONSTRAINT api_albumplace_photos_photo_id_fk
    FOREIGN KEY (photo_id) REFERENCES api_photo(id) ON DELETE CASCADE;

ALTER TABLE api_albumdate_photos ADD CONSTRAINT api_albumdate_photos_photo_id_fk
    FOREIGN KEY (photo_id) REFERENCES api_photo(id) ON DELETE CASCADE;

ALTER TABLE api_albumauto_photos ADD CONSTRAINT api_albumauto_photos_photo_id_fk
    FOREIGN KEY (photo_id) REFERENCES api_photo(id) ON DELETE CASCADE;

ALTER TABLE api_person ADD CONSTRAINT api_person_cover_photo_id_fk
    FOREIGN KEY (cover_photo_id) REFERENCES api_photo(id) ON DELETE SET NULL;

ALTER TABLE api_albumuser ADD CONSTRAINT api_albumuser_cover_photo_id_fk
    FOREIGN KEY (cover_photo_id) REFERENCES api_photo(id) ON DELETE SET NULL;

ALTER TABLE api_albumthing_cover_photos ADD CONSTRAINT api_albumthing_cover_photos_photo_id_fk
    FOREIGN KEY (photo_id) REFERENCES api_photo(id) ON DELETE CASCADE;

ALTER TABLE api_thumbnail ADD CONSTRAINT api_thumbnail_photo_id_fk
    FOREIGN KEY (photo_id) REFERENCES api_photo(id) ON DELETE CASCADE;

ALTER TABLE api_photo_caption ADD CONSTRAINT api_photo_caption_photo_id_fk
    FOREIGN KEY (photo_id) REFERENCES api_photo(id) ON DELETE CASCADE;

ALTER TABLE api_photo_search ADD CONSTRAINT api_photo_search_photo_id_fk
    FOREIGN KEY (photo_id) REFERENCES api_photo(id) ON DELETE CASCADE;

ALTER TABLE api_photostack ADD CONSTRAINT api_photostack_primary_photo_id_fk
    FOREIGN KEY (primary_photo_id) REFERENCES api_photo(id) ON DELETE SET NULL;

-- Step 10: Create indexes for performance
CREATE INDEX api_face_photo_id_idx ON api_face(photo_id);
CREATE INDEX api_photo_shared_to_photo_id_idx ON api_photo_shared_to(photo_id);
CREATE INDEX api_photo_files_photo_id_idx ON api_photo_files(photo_id);
CREATE INDEX api_person_cover_photo_id_idx ON api_person(cover_photo_id);
CREATE INDEX api_albumuser_cover_photo_id_idx ON api_albumuser(cover_photo_id);
CREATE INDEX api_photostack_primary_photo_id_idx ON api_photostack(primary_photo_id);

-- Clean up temp table
DROP TABLE photo_id_mapping;
"""


# ============================================================================
# Forward / reverse Python entry points
# ============================================================================

def migrate_forward(apps, schema_editor):
    """Forward migration - dispatches to PostgreSQL or SQLite implementation."""
    vendor = schema_editor.connection.vendor
    if vendor == "postgresql":
        _migrate_postgresql(schema_editor)
    elif vendor == "sqlite":
        _migrate_sqlite(schema_editor)
    else:
        raise ValueError(
            f"Unsupported database backend: {vendor}. "
            f"This migration supports PostgreSQL and SQLite only."
        )


def migrate_reverse(apps, schema_editor):
    """Reverse migration - not supported for any backend."""
    raise RuntimeError(
        "Migration 0099_photo_uuid_primary_key cannot be reversed automatically. "
        "Please restore from your pre-migration database backup and run: "
        "python manage.py migrate api 0098 --fake"
    )


# ============================================================================
# PostgreSQL implementation
# ============================================================================

def _migrate_postgresql(schema_editor):
    """Execute the PostgreSQL-specific migration using raw SQL."""
    statements = schema_editor.connection.ops.prepare_sql_script(
        POSTGRESQL_FORWARD_SQL
    )
    for statement in statements:
        schema_editor.execute(statement)


# ============================================================================
# SQLite implementation  (table-recreation pattern)
# ============================================================================
#
# SQLite does not support most ALTER TABLE operations required by the
# PostgreSQL path (DROP/ADD CONSTRAINT, ADD PRIMARY KEY, ALTER COLUMN,
# UPDATE … FROM, gen_random_uuid(), etc.).
#
# Instead we use the standard SQLite table-recreation pattern:
#   1. CREATE TABLE …__new  (with the desired schema)
#   2. INSERT INTO …__new SELECT … FROM …  (copy data, translating FKs)
#   3. DROP TABLE …
#   4. ALTER TABLE …__new RENAME TO …
#   5. Re-create indexes
# ============================================================================

def _migrate_sqlite(schema_editor):
    """Execute the SQLite-compatible migration via table recreation."""
    cursor = schema_editor.connection.cursor()

    # Disable FK enforcement while we recreate tables
    cursor.execute("PRAGMA foreign_keys = OFF")

    try:
        # -- Step 1: Build image_hash → UUID mapping --------------------------
        cursor.execute('SELECT "image_hash" FROM "api_photo"')
        mapping = {row[0]: str(uuid.uuid4()) for row in cursor.fetchall()}

        # -- Step 2: Add id column to api_photo and populate UUIDs ------------
        cursor.execute('ALTER TABLE "api_photo" ADD COLUMN "id" TEXT')
        for image_hash, new_id in mapping.items():
            cursor.execute(
                'UPDATE "api_photo" SET "id" = ? WHERE "image_hash" = ?',
                [new_id, image_hash],
            )

        # -- Step 3: Recreate api_photo with id as PK ------------------------
        _sqlite_recreate_table(
            cursor,
            "api_photo",
            pk_column="id",
            column_overrides={
                "id": '"id" TEXT NOT NULL',
                "image_hash": '"image_hash" varchar(64) NOT NULL UNIQUE',
            },
        )

        # -- Step 4: Update FK references in every related table --------------
        _FK_TABLES = [
            ("api_face", "photo_id"),
            ("api_photo_shared_to", "photo_id"),
            ("api_photo_files", "photo_id"),
            ("api_albumuser_photos", "photo_id"),
            ("api_albumthing_photos", "photo_id"),
            ("api_albumplace_photos", "photo_id"),
            ("api_albumdate_photos", "photo_id"),
            ("api_albumauto_photos", "photo_id"),
            ("api_albumthing_cover_photos", "photo_id"),
            ("api_person", "cover_photo_id"),
            ("api_albumuser", "cover_photo_id"),
            ("api_photostack", "primary_photo_id"),
            ("api_thumbnail", "photo_id"),
            ("api_photo_caption", "photo_id"),
            ("api_photo_search", "photo_id"),
        ]
        for table_name, fk_column in _FK_TABLES:
            _sqlite_update_fk_table(cursor, table_name, fk_column, mapping)

        # -- Step 5: Create performance indexes -------------------------------
        _sqlite_create_indexes(cursor)

    finally:
        cursor.execute("PRAGMA foreign_keys = ON")


# -- SQLite helpers -----------------------------------------------------------

def _sqlite_recreate_table(cursor, table_name, pk_column, column_overrides):
    """
    Recreate *api_photo* with a new primary-key column.

    * ``pk_column``        – name of the column that becomes PRIMARY KEY
    * ``column_overrides`` – dict  column_name → SQL column-definition fragment
                             (without PRIMARY KEY – that is appended automatically
                              for *pk_column*)
    """
    columns = _sqlite_column_info(cursor, table_name)
    indexes = _sqlite_index_info(cursor, table_name)

    col_defs = []
    col_names = []
    for _cid, name, type_, notnull, dflt_value, _pk in columns:
        col_names.append(name)
        if name in column_overrides:
            defn = column_overrides[name]
            if name == pk_column:
                defn += " PRIMARY KEY"
            col_defs.append(defn)
        else:
            parts = [f'"{name}"', type_ or "TEXT"]
            if name == pk_column:
                parts.append("NOT NULL PRIMARY KEY")
            elif notnull:
                parts.append("NOT NULL")
            if dflt_value is not None and name != pk_column:
                parts.append(f"DEFAULT {dflt_value}")
            col_defs.append(" ".join(parts))

    cols_quoted = ", ".join(f'"{c}"' for c in col_names)
    new_table = f"{table_name}__new"

    cursor.execute(f'CREATE TABLE "{new_table}" ({", ".join(col_defs)})')
    cursor.execute(
        f'INSERT INTO "{new_table}" ({cols_quoted}) '
        f'SELECT {cols_quoted} FROM "{table_name}"'
    )
    cursor.execute(f'DROP TABLE "{table_name}"')
    cursor.execute(f'ALTER TABLE "{new_table}" RENAME TO "{table_name}"')

    # Re-create any existing indexes
    for _idx_name, idx_sql in indexes:
        try:
            cursor.execute(idx_sql)
        except Exception:
            pass  # index may conflict with new UNIQUE constraint


def _sqlite_update_fk_table(cursor, table_name, fk_column, mapping):
    """
    Recreate *table_name* so that every value in *fk_column* is translated
    from the old image_hash to the new UUID via *mapping*.
    """
    # Guard: skip if the table or column doesn't exist
    cursor.execute(
        "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name=?",
        [table_name],
    )
    if cursor.fetchone()[0] == 0:
        return

    columns = _sqlite_column_info(cursor, table_name)
    col_names_list = [col[1] for col in columns]
    if fk_column not in col_names_list:
        return

    indexes = _sqlite_index_info(cursor, table_name)

    # Build column definitions – change the FK column type to TEXT
    col_defs = []
    col_names = []
    fk_col_idx = None

    for _cid, name, type_, notnull, dflt_value, pk in columns:
        col_names.append(name)
        if name == fk_column:
            fk_col_idx = len(col_names) - 1
            parts = [f'"{name}" TEXT']
            if pk:
                parts.append("NOT NULL PRIMARY KEY")
            col_defs.append(" ".join(parts))
        else:
            parts = [f'"{name}"', type_ or "TEXT"]
            if pk:
                parts.append("PRIMARY KEY")
            if notnull and not pk:
                parts.append("NOT NULL")
            if dflt_value is not None:
                parts.append(f"DEFAULT {dflt_value}")
            col_defs.append(" ".join(parts))

    cols_quoted = ", ".join(f'"{c}"' for c in col_names)
    new_table = f"{table_name}__new"

    # Create new table and bulk-copy data
    cursor.execute(f'CREATE TABLE "{new_table}" ({", ".join(col_defs)})')
    cursor.execute(
        f'INSERT INTO "{new_table}" ({cols_quoted}) '
        f'SELECT {cols_quoted} FROM "{table_name}"'
    )

    # Translate FK values in the new table
    for old_hash, new_uuid in mapping.items():
        cursor.execute(
            f'UPDATE "{new_table}" SET "{fk_column}" = ? '
            f'WHERE "{fk_column}" = ?',
            [new_uuid, old_hash],
        )

    # Swap tables
    cursor.execute(f'DROP TABLE "{table_name}"')
    cursor.execute(f'ALTER TABLE "{new_table}" RENAME TO "{table_name}"')

    # Re-create indexes
    for _idx_name, idx_sql in indexes:
        try:
            cursor.execute(idx_sql)
        except Exception:
            pass


def _sqlite_create_indexes(cursor):
    """Create the same performance indexes as the PostgreSQL path."""
    index_defs = [
        (True, "api_photo_image_hash_unique", "api_photo", "image_hash"),
        (False, "api_face_photo_id_idx", "api_face", "photo_id"),
        (False, "api_photo_shared_to_photo_id_idx", "api_photo_shared_to", "photo_id"),
        (False, "api_photo_files_photo_id_idx", "api_photo_files", "photo_id"),
        (False, "api_person_cover_photo_id_idx", "api_person", "cover_photo_id"),
        (False, "api_albumuser_cover_photo_id_idx", "api_albumuser", "cover_photo_id"),
        (False, "api_photostack_primary_photo_id_idx", "api_photostack", "primary_photo_id"),
    ]
    for unique, idx_name, table, column in index_defs:
        unique_kw = "UNIQUE " if unique else ""
        try:
            cursor.execute(
                f'CREATE {unique_kw}INDEX IF NOT EXISTS '
                f'"{idx_name}" ON "{table}"("{column}")'
            )
        except Exception:
            pass


def _sqlite_column_info(cursor, table_name):
    """Return PRAGMA table_info rows for *table_name*."""
    cursor.execute(f'PRAGMA table_info("{table_name}")')
    return cursor.fetchall()


def _sqlite_index_info(cursor, table_name):
    """Return (name, sql) for every explicit index on *table_name*."""
    cursor.execute(
        "SELECT name, sql FROM sqlite_master "
        "WHERE type='index' AND tbl_name=? AND sql IS NOT NULL",
        [table_name],
    )
    return cursor.fetchall()


# ============================================================================
# Migration class
# ============================================================================

class Migration(migrations.Migration):
    """
    Migration to change Photo primary key from image_hash (CharField) to id (UUIDField).

    WARNING: This migration is NOT reversible through Django's migration system.
    You MUST have a database backup before running this migration.

    Steps:
    1. Add UUID column to api_photo
    2. Generate UUIDs for existing photos
    3. Add UUID columns to all related tables (to store new FK values)
    4. Populate new UUID FK columns from image_hash lookups
    5. Drop all old FK constraints
    6. Drop old PK, add new PK
    7. Drop old FK columns, rename new FK columns
    8. Recreate all FK constraints
    """

    dependencies = [
        ('api', '0098_add_photo_stack'),
    ]

    operations = [
        migrations.SeparateDatabaseAndState(
            database_operations=[
                migrations.RunPython(migrate_forward, migrate_reverse),
            ],
            state_operations=[
                # Add the new UUID primary key field
                migrations.AddField(
                    model_name='photo',
                    name='id',
                    field=models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False),
                ),
                # Change image_hash from primary_key=True to just unique=True
                migrations.AlterField(
                    model_name='photo',
                    name='image_hash',
                    field=models.CharField(db_index=True, max_length=64, unique=True),
                ),
            ],
        ),
    ]
