"""Tests for the migration that gives a user one unknown face cluster (0241).

Before it, concurrent face scans could each create an unknown cluster (-1), and
``get_or_create_cluster_by_id`` then logged "Multiple clusters found" on every
scan. The migration merges such duplicates into the oldest one, faces
included, before the unique constraint goes on. Like the 0156 tests, each test
takes the schema back with the real executor, hence ``TransactionTestCase``.
"""

from django.db import connection
from django.db.migrations.executor import MigrationExecutor
from django.test import TransactionTestCase

BEFORE = ("api", "0240_photo_edit_face_boxes")
AFTER = ("api", "0241_cluster_unique_cluster_id")


class MergeDuplicateClustersMigrationTest(TransactionTestCase):
    def migrate(self, target: tuple[str, str]) -> MigrationExecutor:
        executor = MigrationExecutor(connection)
        executor.migrate([target])
        return MigrationExecutor(connection)

    def _migrate_to_latest(self) -> None:
        executor = MigrationExecutor(connection)
        executor.migrate(executor.loader.graph.leaf_nodes("api"))

    def setUp(self) -> None:
        super().setUp()
        self.addCleanup(self._migrate_to_latest)
        executor = self.migrate(BEFORE)
        self.old_apps = executor.loader.project_state(BEFORE).apps

    def test_duplicates_merge_into_the_oldest_with_their_faces(self) -> None:
        User = self.old_apps.get_model("api", "User")
        Cluster = self.old_apps.get_model("api", "Cluster")
        Face = self.old_apps.get_model("api", "Face")
        user = User.objects.create(username="old")  # raw-create: model at 0240
        other = User.objects.create(username="other")  # raw-create: model at 0240
        kept, duplicate = (
            Cluster.objects.create(  # raw-create: duplicates 0241 forbids
                owner=user, cluster_id=-1, mean_face_encoding=""
            )
            for _ in range(2)
        )
        others = Cluster.objects.create(  # raw-create: model at 0240
            owner=other, cluster_id=-1, mean_face_encoding=""
        )
        face = Face.objects.create(  # raw-create: model at 0240
            cluster=duplicate,
            encoding="",
            location_top=0,
            location_bottom=1,
            location_left=0,
            location_right=1,
        )

        self.migrate(AFTER)

        with connection.cursor() as cursor:
            cursor.execute("SELECT id FROM api_cluster ORDER BY id")
            self.assertEqual(cursor.fetchall(), [(kept.pk,), (others.pk,)])
            cursor.execute("SELECT cluster_id FROM api_face WHERE id = %s", [face.pk])
            self.assertEqual(cursor.fetchall(), [(kept.pk,)])
