"""Characterization tests for ``api.face_classify.cluster_faces`` (unit 11).

These pin the CURRENT behaviour of ``cluster_faces`` before it is refactored.

Nothing heavy runs here: the only "ML" involved is ``sklearn.decomposition.PCA``
on a handful of tiny vectors, and several tests patch it out entirely so the
projected coordinates are deterministic.

Some assertions encode quirks/bugs of the current implementation; each one is
called out in a comment so the refactorer knows the behaviour is intentional
(i.e. observed, not aspirational).
"""

from unittest.mock import patch

import numpy as np
from django.test import TestCase

from api.face_classify import cluster_faces
from api.models.cluster import UNKNOWN_CLUSTER_ID
from api.tests.utils import (
    create_test_face,
    create_test_person,
    create_test_photo,
    create_test_user,
)


def enc_hex(seed, length=128):
    """Hex-encoded float64 vector, in the format ``Face.encoding`` stores."""
    rng = np.random.RandomState(seed)
    return rng.rand(length).astype(np.float64).tobytes().hex()


class FakePCA:
    """Deterministic stand-in for ``sklearn.decomposition.PCA``."""

    last_input = None

    def __init__(self, n_components=None):
        self.n_components = n_components

    def fit_transform(self, X):
        FakePCA.last_input = X
        return np.array([[i * 1.0, i * 2.0, i * 3.0] for i in range(len(X))])


class ClusterFacesEmptyTest(TestCase):
    """The early-return branch: no usable encodings at all."""

    def setUp(self):
        self.user = create_test_user()
        self.photo = create_test_photo(owner=self.user)

    def test_no_faces_returns_empty_data(self):
        self.assertEqual(cluster_faces(self.user), {"status": True, "data": []})

    def test_face_with_blank_encoding_is_skipped(self):
        face = create_test_face(photo=self.photo)
        # ``create_test_face`` substitutes a random encoding for a falsy one, so
        # the blank has to be written afterwards.
        face.encoding = ""
        face.save()
        self.assertEqual(cluster_faces(self.user), {"status": True, "data": []})

    def test_blank_encoding_face_is_dropped_from_a_populated_result(self):
        for i in range(3):
            create_test_face(photo=self.photo, encoding=enc_hex(i + 90))
        blank = create_test_face(photo=self.photo)
        blank.encoding = ""
        blank.save()
        self.assertEqual(len(cluster_faces(self.user)["data"]), 3)

    def test_deleted_faces_are_excluded(self):
        for i in range(3):
            create_test_face(photo=self.photo, deleted=True, encoding=enc_hex(i))
        self.assertEqual(cluster_faces(self.user), {"status": True, "data": []})

    def test_other_users_faces_are_excluded(self):
        other = create_test_user()
        other_photo = create_test_photo(owner=other)
        for i in range(3):
            create_test_face(photo=other_photo, encoding=enc_hex(i))
        self.assertEqual(cluster_faces(self.user), {"status": True, "data": []})

    def test_inferred_false_skips_labeled_faces(self):
        person = create_test_person(cluster_owner=self.user)
        for i in range(3):
            create_test_face(photo=self.photo, person=person, encoding=enc_hex(i))
        # inferred=True keeps them, inferred=False drops every labeled face
        self.assertEqual(len(cluster_faces(self.user, inferred=True)["data"]), 3)
        self.assertEqual(
            cluster_faces(self.user, inferred=False), {"status": True, "data": []}
        )


class ClusterFacesUnknownFacesTest(TestCase):
    """Faces with no ``person`` -> the "unknown" branch."""

    def setUp(self):
        self.user = create_test_user()
        self.photo = create_test_photo(owner=self.user)
        for i in range(3):
            create_test_face(
                photo=self.photo, image="test.jpg", encoding=enc_hex(i + 10)
            )

    def test_unknown_faces_shape_and_defaults(self):
        result = cluster_faces(self.user)
        self.assertTrue(result["status"])
        self.assertEqual(len(result["data"]), 3)
        for entry in result["data"]:
            self.assertEqual(entry["person_id"], UNKNOWN_CLUSTER_ID)
            self.assertEqual(entry["person_name"], "unknown")
            self.assertTrue(entry["person_label_is_inferred"])
            # No labeled person exists, so p2c is empty and the fallback colour
            # is used for every unknown face.
            self.assertEqual(entry["color"], "#000000")
            self.assertEqual(entry["face_url"], "/media/test.jpg")
            self.assertEqual(set(entry["value"]), {"x", "y", "size"})

    def test_value_keys_map_to_first_three_pca_components(self):
        with patch("api.face_classify.PCA", FakePCA):
            result = cluster_faces(self.user)
        values = [e["value"] for e in result["data"]]
        self.assertEqual(
            values,
            [
                {"x": 0.0, "y": 0.0, "size": 0.0},
                {"x": 1.0, "y": 2.0, "size": 3.0},
                {"x": 2.0, "y": 4.0, "size": 6.0},
            ],
        )
        # PCA is fed a plain list of decoded 128-dim float vectors.
        self.assertEqual(len(FakePCA.last_input), 3)
        self.assertEqual(len(FakePCA.last_input[0]), 128)

    def test_pca_is_requested_with_three_components(self):
        with patch("api.face_classify.PCA", wraps=FakePCA) as pca_cls:
            cluster_faces(self.user)
        pca_cls.assert_called_once_with(n_components=3)


class ClusterFacesLabeledFacesTest(TestCase):
    """Faces with a ``person`` -> the labeled branch and colour palette."""

    def setUp(self):
        self.user = create_test_user()
        self.photo = create_test_photo(owner=self.user)
        self.person = create_test_person(name="Alice", cluster_owner=self.user)
        for i in range(3):
            create_test_face(
                photo=self.photo,
                image="test.jpg",
                person=self.person,
                encoding=enc_hex(i + 20),
            )

    def test_labeled_faces_get_person_data_and_palette_colour(self):
        with patch("api.face_classify.PCA", FakePCA):
            result = cluster_faces(self.user)
        self.assertEqual(len(result["data"]), 3)
        for entry in result["data"]:
            self.assertEqual(entry["person_id"], self.person.id)
            self.assertEqual(entry["person_name"], "Alice")
            self.assertFalse(entry["person_label_is_inferred"])
            # hex_palette(n_colors=1) -> first colour of the "deep" palette.
            self.assertEqual(entry["color"], "#4c72b0")

    def test_mixed_labeled_and_unknown_faces(self):
        for i in range(2):
            create_test_face(
                photo=self.photo, image="test.jpg", encoding=enc_hex(i + 30)
            )
        with patch("api.face_classify.PCA", FakePCA):
            result = cluster_faces(self.user)
        self.assertEqual(len(result["data"]), 5)
        labeled = [e for e in result["data"] if e["person_id"] == self.person.id]
        unknown = [e for e in result["data"] if e["person_id"] == UNKNOWN_CLUSTER_ID]
        self.assertEqual(len(labeled), 3)
        self.assertEqual(len(unknown), 2)
        # UNKNOWN_CLUSTER_ID is never a key in p2c, so unknown faces always fall
        # back to black even when a palette exists.
        self.assertEqual({e["color"] for e in unknown}, {"#000000"})
        self.assertEqual({e["color"] for e in labeled}, {"#4c72b0"})

    def test_person_from_another_users_faces_is_not_in_palette(self):
        """A person only counts if the user owns a photo of one of its faces."""
        other = create_test_user()
        other_photo = create_test_photo(owner=other)
        foreign = create_test_person(name="Bob", cluster_owner=other)
        create_test_face(photo=other_photo, person=foreign, encoding=enc_hex(40))
        with patch("api.face_classify.PCA", FakePCA):
            result = cluster_faces(self.user)
        self.assertEqual({e["person_name"] for e in result["data"]}, {"Alice"})

    def test_two_people_get_distinct_palette_colours(self):
        second = create_test_person(name="Carol", cluster_owner=self.user)
        for i in range(2):
            create_test_face(
                photo=self.photo,
                image="test.jpg",
                person=second,
                encoding=enc_hex(i + 50),
            )
        with patch("api.face_classify.PCA", FakePCA):
            result = cluster_faces(self.user)
        colors = {e["person_name"]: e["color"] for e in result["data"]}
        self.assertEqual(len(colors), 2)
        # Two people -> the first two colours of the "deep" palette, assigned in
        # the (database-dependent) order of the distinct persons queryset.
        self.assertEqual(set(colors.values()), {"#4c72b0", "#dd8452"})


class ClusterFacesPcaConstraintTest(TestCase):
    """PCA(n_components=3) needs at least three samples: pin the failure."""

    def setUp(self):
        self.user = create_test_user()
        self.photo = create_test_photo(owner=self.user)

    def test_fewer_than_three_faces_raises_value_error(self):
        # KNOWN SHARP EDGE (kept as-is): one or two usable encodings blow up
        # inside PCA rather than returning a result.  A refactor must not
        # silently change this without a decision.
        for i in range(2):
            create_test_face(photo=self.photo, encoding=enc_hex(i + 60))
        with self.assertRaises(ValueError):
            cluster_faces(self.user)

    def test_three_faces_is_the_smallest_working_input(self):
        for i in range(3):
            create_test_face(photo=self.photo, encoding=enc_hex(i + 70))
        result = cluster_faces(self.user)
        self.assertEqual(len(result["data"]), 3)


class ClusterFacesPaginationTest(TestCase):
    """Faces are read through a Paginator; every page must be consumed."""

    def setUp(self):
        self.user = create_test_user()
        self.photo = create_test_photo(owner=self.user)
        for i in range(6):
            create_test_face(photo=self.photo, encoding=enc_hex(i + 80))

    def test_all_pages_are_walked(self):
        with patch("api.face_classify.Paginator") as paginator_cls:
            from django.core.paginator import Paginator as RealPaginator

            paginator_cls.side_effect = lambda qs, per_page: RealPaginator(qs, 2)
            with patch("api.face_classify.PCA", FakePCA):
                result = cluster_faces(self.user)
        self.assertEqual(len(result["data"]), 6)
        paginator_cls.assert_called_once()
        # Page size used by the production code path.
        self.assertEqual(paginator_cls.call_args[0][1], 5000)
