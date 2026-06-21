import importlib

import numpy as np
from django.apps import apps as global_apps
from django.test import TestCase

from api.models import Cluster, Face

from .utils import create_test_face

# The migration module name starts with a digit, so it can't be imported with a
# normal `import` statement.
migration_0126 = importlib.import_module(
    "api.migrations.0126_clear_128dim_face_encodings"
)


def encoding_of_length(num_floats):
    """A hex-encoded encoding string for `num_floats` float64 values."""
    return np.random.rand(num_floats).tobytes().hex()


class Clear128DimFaceEncodingsMigrationTest(TestCase):
    def test_only_128dim_encodings_are_cleared_and_clusters_deleted(self):
        # 128-dim (2048 hex chars): must be cleared.
        old_a = create_test_face(encoding=encoding_of_length(128))
        old_b = create_test_face(encoding=encoding_of_length(128))
        # 512-dim ArcFace (8192 hex chars): must be left untouched.
        new = create_test_face(encoding=encoding_of_length(512))
        # Already-empty: untouched, and not matched by the length filter.
        empty = create_test_face(encoding="")

        # A face attached to a cluster: the cluster is deleted but the face
        # survives (Face.cluster is on_delete=SET_NULL).
        cluster = Cluster.objects.create(mean_face_encoding="")
        clustered = create_test_face(encoding=encoding_of_length(128), cluster=cluster)

        self.assertEqual(Cluster.objects.count(), 1)

        migration_0126.clear_128dim_face_encodings(global_apps, None)

        for face in (old_a, old_b, clustered):
            face.refresh_from_db()
            self.assertEqual(face.encoding, "")

        new.refresh_from_db()
        self.assertEqual(len(new.encoding), 512 * 8 * 2)

        empty.refresh_from_db()
        self.assertEqual(empty.encoding, "")

        # All faces still exist; only the cluster link was severed.
        self.assertEqual(Face.objects.count(), 5)
        self.assertEqual(Cluster.objects.count(), 0)
        clustered.refresh_from_db()
        self.assertIsNone(clustered.cluster)
