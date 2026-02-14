"""
Tests for migration 0099_photo_uuid_primary_key.

Verifies the UUID primary key migration works correctly on both
PostgreSQL (raw SQL) and SQLite (table recreation pattern).

Strategy:
- Migration 0099 is irreversible, so we cannot use the standard
  "roll back → seed → migrate forward" pattern.
- Instead we build a standalone in-memory SQLite database with the
  pre-migration schema, seed data, run the migration function
  directly, and verify the result (TestSQLiteMigration0099).
- We also verify the post-migration schema on the live Django test DB
  (which already had 0099 applied during test-database creation)
  in TestPostMigrationSchema.
- Helper functions are tested in isolation in TestSQLiteHelpers.
"""

import sqlite3
import uuid
from importlib import import_module
from unittest.mock import MagicMock, patch

from django.db import connection
from django.test import TestCase, TransactionTestCase

# Import the migration module (name starts with a digit, use importlib)
_mod = import_module("api.migrations.0099_photo_uuid_primary_key")


# ============================================================================
# Helpers
# ============================================================================

def _sqlite_table_exists(cursor, table_name):
    cursor.execute(
        "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name=?",
        [table_name],
    )
    return cursor.fetchone()[0] > 0


def _sqlite_column_names(cursor, table_name):
    cursor.execute(f'PRAGMA table_info("{table_name}")')
    return {row[1] for row in cursor.fetchall()}


def _sqlite_pk_columns(cursor, table_name):
    cursor.execute(f'PRAGMA table_info("{table_name}")')
    return [row[1] for row in cursor.fetchall() if row[5]]


def _sqlite_index_exists(cursor, index_name):
    cursor.execute(
        "SELECT COUNT(*) FROM sqlite_master WHERE type='index' AND name=?",
        [index_name],
    )
    return cursor.fetchone()[0] > 0


# ============================================================================
# Pre-migration schema builder  (mimics the tables that exist at 0098)
# ============================================================================

_PRE_MIGRATION_DDL = """
CREATE TABLE api_photo (
    image_hash VARCHAR(64) NOT NULL PRIMARY KEY,
    hidden     INTEGER NOT NULL DEFAULT 0,
    rating     INTEGER NOT NULL DEFAULT 0,
    deleted    INTEGER NOT NULL DEFAULT 0,
    video      INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE api_face (
    id                           INTEGER PRIMARY KEY AUTOINCREMENT,
    photo_id                     VARCHAR(64) NOT NULL REFERENCES api_photo(image_hash),
    location_top                 INTEGER NOT NULL DEFAULT 0,
    location_bottom              INTEGER NOT NULL DEFAULT 0,
    location_left                INTEGER NOT NULL DEFAULT 0,
    location_right               INTEGER NOT NULL DEFAULT 0,
    deleted                      INTEGER NOT NULL DEFAULT 0,
    classification_probability   REAL NOT NULL DEFAULT 0.0,
    cluster_probability          REAL NOT NULL DEFAULT 0.0
);

CREATE TABLE api_thumbnail (
    photo_id     VARCHAR(64) NOT NULL PRIMARY KEY REFERENCES api_photo(image_hash),
    aspect_ratio REAL
);

CREATE TABLE api_photo_caption (
    photo_id VARCHAR(64) NOT NULL PRIMARY KEY REFERENCES api_photo(image_hash)
);

CREATE TABLE api_photo_search (
    photo_id VARCHAR(64) NOT NULL PRIMARY KEY REFERENCES api_photo(image_hash)
);

CREATE TABLE api_person (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    name           TEXT NOT NULL,
    kind           TEXT NOT NULL DEFAULT 'USER',
    cover_photo_id VARCHAR(64) REFERENCES api_photo(image_hash),
    face_count     INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE api_albumuser (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    title          TEXT,
    cover_photo_id VARCHAR(64) REFERENCES api_photo(image_hash)
);

CREATE TABLE api_photo_shared_to (
    id       INTEGER PRIMARY KEY AUTOINCREMENT,
    photo_id VARCHAR(64) NOT NULL REFERENCES api_photo(image_hash),
    user_id  INTEGER NOT NULL
);

CREATE TABLE api_photo_files (
    id       INTEGER PRIMARY KEY AUTOINCREMENT,
    photo_id VARCHAR(64) NOT NULL REFERENCES api_photo(image_hash),
    file_id  INTEGER NOT NULL
);

CREATE TABLE api_albumuser_photos (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    albumuser_id   INTEGER NOT NULL,
    photo_id       VARCHAR(64) NOT NULL REFERENCES api_photo(image_hash)
);

CREATE TABLE api_albumthing_photos (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    albumthing_id   INTEGER NOT NULL,
    photo_id        VARCHAR(64) NOT NULL REFERENCES api_photo(image_hash)
);

CREATE TABLE api_albumplace_photos (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    albumplace_id   INTEGER NOT NULL,
    photo_id        VARCHAR(64) NOT NULL REFERENCES api_photo(image_hash)
);

CREATE TABLE api_albumdate_photos (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    albumdate_id   INTEGER NOT NULL,
    photo_id       VARCHAR(64) NOT NULL REFERENCES api_photo(image_hash)
);

CREATE TABLE api_albumauto_photos (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    albumauto_id   INTEGER NOT NULL,
    photo_id       VARCHAR(64) NOT NULL REFERENCES api_photo(image_hash)
);

CREATE TABLE api_albumthing_cover_photos (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    albumthing_id   INTEGER NOT NULL,
    photo_id        VARCHAR(64) NOT NULL REFERENCES api_photo(image_hash)
);

CREATE TABLE api_photostack (
    id               TEXT PRIMARY KEY,
    primary_photo_id VARCHAR(64) REFERENCES api_photo(image_hash)
);

CREATE INDEX api_face_photo_id_old ON api_face(photo_id);
"""


def _build_test_db():
    """Create an in-memory SQLite DB with the pre-migration schema and seed data.

    Returns (connection, hashes) where hashes is a list of image_hash values.
    """
    conn = sqlite3.connect(":memory:")
    cur = conn.cursor()
    cur.executescript(_PRE_MIGRATION_DDL)

    hashes = [f"hash_{i:032d}" for i in range(1, 4)]
    for h in hashes:
        cur.execute(
            "INSERT INTO api_photo (image_hash) VALUES (?)", [h]
        )

    # face referencing photo 0
    cur.execute(
        "INSERT INTO api_face (photo_id, location_top, location_bottom, "
        "location_left, location_right, deleted, classification_probability, "
        "cluster_probability) VALUES (?, 0, 100, 0, 100, 0, 0.5, 0.5)",
        [hashes[0]],
    )
    # second face referencing photo 1
    cur.execute(
        "INSERT INTO api_face (photo_id, location_top, location_bottom, "
        "location_left, location_right, deleted, classification_probability, "
        "cluster_probability) VALUES (?, 10, 200, 10, 200, 0, 0.8, 0.3)",
        [hashes[1]],
    )
    # thumbnail for photo 0
    cur.execute("INSERT INTO api_thumbnail (photo_id, aspect_ratio) VALUES (?, 1.5)", [hashes[0]])
    # caption for photo 1
    cur.execute("INSERT INTO api_photo_caption (photo_id) VALUES (?)", [hashes[1]])
    # search for photo 2
    cur.execute("INSERT INTO api_photo_search (photo_id) VALUES (?)", [hashes[2]])
    # person with cover_photo
    cur.execute("INSERT INTO api_person (name, cover_photo_id) VALUES (?, ?)", ["Alice", hashes[0]])
    # album user with cover_photo
    cur.execute("INSERT INTO api_albumuser (title, cover_photo_id) VALUES (?, ?)", ["My Album", hashes[1]])
    # M2M entries
    cur.execute("INSERT INTO api_photo_shared_to (photo_id, user_id) VALUES (?, 1)", [hashes[0]])
    cur.execute("INSERT INTO api_albumuser_photos (albumuser_id, photo_id) VALUES (1, ?)", [hashes[0]])
    cur.execute("INSERT INTO api_albumthing_photos (albumthing_id, photo_id) VALUES (1, ?)", [hashes[1]])
    cur.execute("INSERT INTO api_albumplace_photos (albumplace_id, photo_id) VALUES (1, ?)", [hashes[2]])
    cur.execute("INSERT INTO api_albumdate_photos (albumdate_id, photo_id) VALUES (1, ?)", [hashes[0]])
    cur.execute("INSERT INTO api_albumauto_photos (albumauto_id, photo_id) VALUES (1, ?)", [hashes[1]])
    cur.execute("INSERT INTO api_albumthing_cover_photos (albumthing_id, photo_id) VALUES (1, ?)", [hashes[2]])
    cur.execute("INSERT INTO api_photostack (id, primary_photo_id) VALUES (?, ?)", ["stack-1", hashes[0]])

    conn.commit()
    return conn, hashes


def _run_migration_on(sqlite_conn):
    """Run the SQLite migration path on the given raw sqlite3 connection."""
    # _migrate_sqlite expects a Django-like schema_editor with
    # .connection.cursor() returning something with .execute/.fetchall.
    # We wrap the raw sqlite3 connection to match.
    class _CursorWrapper:
        """Thin adapter so _migrate_sqlite can call cursor.execute(sql, params)."""
        def __init__(self, raw_cursor):
            self._cur = raw_cursor
        def execute(self, sql, params=None):
            if params is None:
                return self._cur.execute(sql)
            return self._cur.execute(sql, params)
        def fetchall(self):
            return self._cur.fetchall()
        def fetchone(self):
            return self._cur.fetchone()

    class _ConnWrapper:
        def __init__(self, raw_conn):
            self._conn = raw_conn
            self.vendor = "sqlite"
        def cursor(self):
            return _CursorWrapper(self._conn.cursor())

    class _SchemaEditor:
        def __init__(self, raw_conn):
            self.connection = _ConnWrapper(raw_conn)

    _mod._migrate_sqlite(_SchemaEditor(sqlite_conn))
    sqlite_conn.commit()


# ============================================================================
# Test: Full end-to-end SQLite migration
# ============================================================================

class TestSQLiteMigration0099(TestCase):
    """
    End-to-end test of the SQLite migration path.

    Creates a standalone in-memory SQLite database with the pre-0099 schema,
    seeds test data, runs `_migrate_sqlite`, and verifies all changes.
    """

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.conn, cls.hashes = _build_test_db()
        _run_migration_on(cls.conn)

    @classmethod
    def tearDownClass(cls):
        cls.conn.close()
        super().tearDownClass()

    def _cursor(self):
        return self.conn.cursor()

    # -- schema assertions -------------------------------------------------

    def test_photo_has_id_column(self):
        cur = self._cursor()
        cols = _sqlite_column_names(cur, "api_photo")
        self.assertIn("id", cols)

    def test_photo_has_image_hash_column(self):
        cur = self._cursor()
        cols = _sqlite_column_names(cur, "api_photo")
        self.assertIn("image_hash", cols)

    def test_photo_pk_is_id(self):
        cur = self._cursor()
        pk = _sqlite_pk_columns(cur, "api_photo")
        self.assertEqual(pk, ["id"])

    def test_image_hash_unique_index(self):
        cur = self._cursor()
        self.assertTrue(_sqlite_index_exists(cur, "api_photo_image_hash_unique"))

    def test_performance_indexes(self):
        expected = [
            "api_face_photo_id_idx",
            "api_photo_shared_to_photo_id_idx",
            "api_photo_files_photo_id_idx",
            "api_person_cover_photo_id_idx",
            "api_albumuser_cover_photo_id_idx",
            "api_photostack_primary_photo_id_idx",
        ]
        cur = self._cursor()
        for idx in expected:
            self.assertTrue(
                _sqlite_index_exists(cur, idx),
                f"Missing index: {idx}",
            )

    # -- data assertions ---------------------------------------------------

    def test_all_photos_have_valid_uuids(self):
        cur = self._cursor()
        cur.execute('SELECT "id" FROM api_photo')
        rows = cur.fetchall()
        self.assertEqual(len(rows), 3)
        for (photo_id,) in rows:
            uuid.UUID(photo_id)  # will raise if invalid

    def test_image_hashes_preserved(self):
        cur = self._cursor()
        cur.execute('SELECT "image_hash" FROM api_photo ORDER BY image_hash')
        actual = [r[0] for r in cur.fetchall()]
        self.assertEqual(actual, sorted(self.hashes))

    def test_each_photo_has_distinct_uuid(self):
        cur = self._cursor()
        cur.execute('SELECT "id" FROM api_photo')
        ids = [r[0] for r in cur.fetchall()]
        self.assertEqual(len(ids), len(set(ids)))

    def test_face_fk_translated(self):
        """Faces should join to photos via the new UUID id."""
        cur = self._cursor()
        cur.execute(
            'SELECT f.photo_id, p.id FROM api_face f '
            'JOIN api_photo p ON f.photo_id = p.id'
        )
        rows = cur.fetchall()
        self.assertEqual(len(rows), 2)
        for fk, pk in rows:
            self.assertEqual(fk, pk)
            uuid.UUID(fk)

    def test_no_orphan_faces(self):
        cur = self._cursor()
        cur.execute(
            'SELECT COUNT(*) FROM api_face f '
            'LEFT JOIN api_photo p ON f.photo_id = p.id '
            'WHERE p.id IS NULL'
        )
        self.assertEqual(cur.fetchone()[0], 0)

    def test_thumbnail_fk_translated(self):
        cur = self._cursor()
        cur.execute(
            'SELECT t.photo_id, p.id FROM api_thumbnail t '
            'JOIN api_photo p ON t.photo_id = p.id'
        )
        rows = cur.fetchall()
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0][0], rows[0][1])

    def test_photo_caption_fk_translated(self):
        cur = self._cursor()
        cur.execute(
            'SELECT c.photo_id, p.id FROM api_photo_caption c '
            'JOIN api_photo p ON c.photo_id = p.id'
        )
        rows = cur.fetchall()
        self.assertEqual(len(rows), 1)

    def test_photo_search_fk_translated(self):
        cur = self._cursor()
        cur.execute(
            'SELECT s.photo_id, p.id FROM api_photo_search s '
            'JOIN api_photo p ON s.photo_id = p.id'
        )
        rows = cur.fetchall()
        self.assertEqual(len(rows), 1)

    def test_person_cover_photo_translated(self):
        cur = self._cursor()
        cur.execute(
            'SELECT per.cover_photo_id, p.id FROM api_person per '
            'JOIN api_photo p ON per.cover_photo_id = p.id'
        )
        rows = cur.fetchall()
        self.assertEqual(len(rows), 1)
        uuid.UUID(rows[0][0])

    def test_albumuser_cover_photo_translated(self):
        cur = self._cursor()
        cur.execute(
            'SELECT a.cover_photo_id, p.id FROM api_albumuser a '
            'JOIN api_photo p ON a.cover_photo_id = p.id'
        )
        rows = cur.fetchall()
        self.assertEqual(len(rows), 1)

    def test_m2m_shared_to_translated(self):
        cur = self._cursor()
        cur.execute(
            'SELECT s.photo_id, p.id FROM api_photo_shared_to s '
            'JOIN api_photo p ON s.photo_id = p.id'
        )
        self.assertEqual(len(cur.fetchall()), 1)

    def test_m2m_albumuser_photos_translated(self):
        cur = self._cursor()
        cur.execute(
            'SELECT a.photo_id, p.id FROM api_albumuser_photos a '
            'JOIN api_photo p ON a.photo_id = p.id'
        )
        self.assertEqual(len(cur.fetchall()), 1)

    def test_m2m_albumthing_photos_translated(self):
        cur = self._cursor()
        cur.execute(
            'SELECT a.photo_id, p.id FROM api_albumthing_photos a '
            'JOIN api_photo p ON a.photo_id = p.id'
        )
        self.assertEqual(len(cur.fetchall()), 1)

    def test_m2m_albumplace_photos_translated(self):
        cur = self._cursor()
        cur.execute(
            'SELECT a.photo_id, p.id FROM api_albumplace_photos a '
            'JOIN api_photo p ON a.photo_id = p.id'
        )
        self.assertEqual(len(cur.fetchall()), 1)

    def test_m2m_albumdate_photos_translated(self):
        cur = self._cursor()
        cur.execute(
            'SELECT a.photo_id, p.id FROM api_albumdate_photos a '
            'JOIN api_photo p ON a.photo_id = p.id'
        )
        self.assertEqual(len(cur.fetchall()), 1)

    def test_m2m_albumauto_photos_translated(self):
        cur = self._cursor()
        cur.execute(
            'SELECT a.photo_id, p.id FROM api_albumauto_photos a '
            'JOIN api_photo p ON a.photo_id = p.id'
        )
        self.assertEqual(len(cur.fetchall()), 1)

    def test_albumthing_cover_photos_translated(self):
        cur = self._cursor()
        cur.execute(
            'SELECT a.photo_id, p.id FROM api_albumthing_cover_photos a '
            'JOIN api_photo p ON a.photo_id = p.id'
        )
        self.assertEqual(len(cur.fetchall()), 1)

    def test_photostack_primary_photo_translated(self):
        cur = self._cursor()
        cur.execute(
            'SELECT s.primary_photo_id, p.id FROM api_photostack s '
            'JOIN api_photo p ON s.primary_photo_id = p.id'
        )
        rows = cur.fetchall()
        self.assertEqual(len(rows), 1)
        uuid.UUID(rows[0][0])


# ============================================================================
# Test: Post-migration schema on the live Django test database
# ============================================================================

class TestPostMigrationSchema(TestCase):
    """
    Verify the Django test DB (where migration 0099 already ran during
    test database creation) has the expected post-migration schema.

    This validates that the migration ran successfully on whatever backend
    the test suite is configured with (SQLite via test_sqlite settings).
    """

    def test_photo_table_has_id_and_image_hash(self):
        with connection.cursor() as cursor:
            if connection.vendor == "sqlite":
                cursor.execute('PRAGMA table_info("api_photo")')
                cols = {row[1] for row in cursor.fetchall()}
            else:
                cursor.execute(
                    "SELECT column_name FROM information_schema.columns "
                    "WHERE table_name = 'api_photo'"
                )
                cols = {row[0] for row in cursor.fetchall()}
        self.assertIn("id", cols)
        self.assertIn("image_hash", cols)

    def test_photo_pk_is_uuid_field(self):
        """Verify Django's ORM sees the PK as a UUID field named 'id'."""
        from api.models import Photo
        pk_field = Photo._meta.pk
        self.assertEqual(pk_field.name, "id")
        self.assertIsInstance(pk_field, __import__("django").db.models.UUIDField)


# ============================================================================
# Test: Dispatch and reverse logic
# ============================================================================

class TestMigrationDispatch(TestCase):
    """Test migrate_forward dispatch and migrate_reverse error."""

    def test_dispatches_to_sqlite(self):
        mock_editor = MagicMock()
        mock_editor.connection.vendor = "sqlite"
        with patch.object(_mod, "_migrate_sqlite") as mock_fn:
            _mod.migrate_forward(MagicMock(), mock_editor)
            mock_fn.assert_called_once_with(mock_editor)

    def test_dispatches_to_postgresql(self):
        mock_editor = MagicMock()
        mock_editor.connection.vendor = "postgresql"
        with patch.object(_mod, "_migrate_postgresql") as mock_fn:
            _mod.migrate_forward(MagicMock(), mock_editor)
            mock_fn.assert_called_once_with(mock_editor)

    def test_rejects_unknown_backend(self):
        mock_editor = MagicMock()
        mock_editor.connection.vendor = "oracle"
        with self.assertRaises(ValueError):
            _mod.migrate_forward(MagicMock(), mock_editor)

    def test_reverse_raises_runtime_error(self):
        with self.assertRaises(RuntimeError):
            _mod.migrate_reverse(MagicMock(), MagicMock())


# ============================================================================
# Test: SQLite helper functions in isolation
# ============================================================================

class TestSQLiteHelpers(TestCase):
    """Unit tests for the individual SQLite helper functions."""

    def test_column_info(self):
        if connection.vendor != "sqlite":
            self.skipTest("SQLite-specific")
        with connection.cursor() as cur:
            cur.execute(
                "CREATE TABLE IF NOT EXISTS _t_col "
                "(pk INTEGER PRIMARY KEY, name TEXT NOT NULL, val REAL)"
            )
            cols = _mod._sqlite_column_info(cur, "_t_col")
            cur.execute("DROP TABLE IF EXISTS _t_col")
        self.assertEqual({c[1] for c in cols}, {"pk", "name", "val"})

    def test_index_info(self):
        if connection.vendor != "sqlite":
            self.skipTest("SQLite-specific")
        with connection.cursor() as cur:
            cur.execute("CREATE TABLE IF NOT EXISTS _t_idx (a TEXT, b TEXT)")
            cur.execute("CREATE INDEX IF NOT EXISTS _t_idx_a ON _t_idx(a)")
            idxs = _mod._sqlite_index_info(cur, "_t_idx")
            cur.execute("DROP TABLE IF EXISTS _t_idx")
        self.assertIn("_t_idx_a", [i[0] for i in idxs])

    def test_recreate_table_changes_pk(self):
        if connection.vendor != "sqlite":
            self.skipTest("SQLite-specific")
        with connection.cursor() as cur:
            cur.execute(
                "CREATE TABLE _t_rec (old_pk TEXT PRIMARY KEY, new_pk TEXT, data TEXT)"
            )
            cur.execute("INSERT INTO _t_rec VALUES ('h1', 'u1', 'a')")
            cur.execute("INSERT INTO _t_rec VALUES ('h2', 'u2', 'b')")

            _mod._sqlite_recreate_table(
                cur, "_t_rec", pk_column="new_pk",
                column_overrides={
                    "new_pk": '"new_pk" TEXT NOT NULL',
                    "old_pk": '"old_pk" TEXT NOT NULL UNIQUE',
                },
            )
            pk = _sqlite_pk_columns(cur, "_t_rec")
            self.assertEqual(pk, ["new_pk"])
            cur.execute("SELECT old_pk, new_pk, data FROM _t_rec ORDER BY old_pk")
            self.assertEqual(cur.fetchall(), [("h1", "u1", "a"), ("h2", "u2", "b")])
            cur.execute("DROP TABLE _t_rec")

    def test_update_fk_table_translates_values(self):
        if connection.vendor != "sqlite":
            self.skipTest("SQLite-specific")
        with connection.cursor() as cur:
            cur.execute("CREATE TABLE _t_parent (id TEXT PRIMARY KEY)")
            cur.execute("INSERT INTO _t_parent VALUES ('uuid-a')")
            cur.execute(
                "CREATE TABLE _t_child (id INTEGER PRIMARY KEY, fk TEXT, info TEXT)"
            )
            cur.execute("INSERT INTO _t_child (fk, info) VALUES ('old', 'r1')")
            cur.execute("INSERT INTO _t_child (fk, info) VALUES ('old', 'r2')")

            _mod._sqlite_update_fk_table(cur, "_t_child", "fk", {"old": "uuid-a"})

            cur.execute("SELECT fk FROM _t_child")
            self.assertTrue(all(r[0] == "uuid-a" for r in cur.fetchall()))
            cur.execute("DROP TABLE _t_child")
            cur.execute("DROP TABLE _t_parent")

    def test_update_fk_table_skips_missing_table(self):
        if connection.vendor != "sqlite":
            self.skipTest("SQLite-specific")
        with connection.cursor() as cur:
            # Should not raise
            _mod._sqlite_update_fk_table(cur, "_no_such_table_999", "col", {"a": "b"})
