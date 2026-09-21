"""Characterization tests for ``api.face_classify`` (unit 10).

Pins the CURRENT behaviour of ``create_all_clusters`` and ``train_faces``
(plus the small helper ``filter_data`` they share) before those functions are
refactored.

Everything heavy is mocked: ``HDBSCAN`` and ``MLPClassifier`` are patched out
in most tests so the clustering / training outcome is deterministic and no real
model fitting happens.  A couple of tests deliberately let the *real*
``MLPClassifier`` run in order to pin the error path it produces on empty
training data (see ``TrainFacesEmptyDataTest``).

Several assertions below encode quirks/bugs of the current implementation;
each is called out in a comment so the refactorer knows what is intentional.
"""

import uuid
from unittest.mock import MagicMock, patch

import numpy as np
from django.test import TestCase

from api import face_classify
from api.face_classify import create_all_clusters, filter_data, train_faces
from api.models import Cluster, Face, LongRunningJob, Person
from api.models.cluster import UNKNOWN_CLUSTER_ID, get_unknown_cluster
from api.tests.utils import (
    create_test_face,
    create_test_person,
    create_test_photo,
    create_test_user,
)


def enc_hex(seed, length=128):
    """Hex encoding of a deterministic float64 vector, as stored on Face."""
    rng = np.random.RandomState(seed)
    return rng.rand(length).astype(np.float64).tobytes().hex()


# ---------------------------------------------------------------------------
# fakes
# ---------------------------------------------------------------------------


class FakeMLP:
    """Stand-in for ``sklearn.neural_network.MLPClassifier``.

    ``predict_proba`` puts the probability mass on the class at
    ``PEAK_INDEX`` so the "person with the highest probability" branches are
    deterministic.
    """

    instances: list["FakeMLP"] = []
    PEAK_INDEX = 0
    PEAK_VALUE = 0.9

    def __init__(self, **kwargs):
        self.kwargs = kwargs
        self.fit_X = None
        self.fit_y = None
        FakeMLP.instances.append(self)

    def fit(self, X, y):
        self.fit_X = np.asarray(X)
        self.fit_y = np.asarray(y)
        self.classes_ = np.unique(self.fit_y)
        return self

    def predict_proba(self, X):
        n_classes = len(self.classes_)
        rows = []
        rest = (1.0 - self.PEAK_VALUE) / max(n_classes - 1, 1)
        for _ in range(len(X)):
            row = [rest] * n_classes
            row[self.PEAK_INDEX] = self.PEAK_VALUE
            rows.append(row)
        return np.array(rows)


def fake_hdbscan(labels):
    """A patched ``HDBSCAN`` class whose fitted object exposes ``labels``."""
    instance = MagicMock()
    instance.labels_ = np.array(labels)
    cls = MagicMock(return_value=instance)
    return cls, instance


# ---------------------------------------------------------------------------
# filter_data
# ---------------------------------------------------------------------------


class FilterDataTest(TestCase):
    def test_keeps_entries_matching_first_shape(self):
        encodings = [[1.0, 2.0], [3.0, 4.0]]
        enc, ids = filter_data(encodings, [10, 11])
        self.assertEqual(enc.shape, (2, 2))
        self.assertEqual(list(ids), [10, 11])

    def test_discards_entries_with_a_different_length(self):
        encodings = [[1.0, 2.0], [3.0], [5.0, 6.0]]
        enc, ids = filter_data(encodings, [10, 11, 12])
        # The *first* entry defines the expected shape; mismatches are dropped.
        self.assertEqual(enc.shape, (2, 2))
        self.assertEqual(list(ids), [10, 12])

    def test_empty_input_yields_empty_arrays(self):
        enc, ids = filter_data([], [])
        self.assertEqual(enc.size, 0)
        self.assertEqual(ids.size, 0)

    def test_zip_truncates_to_the_shorter_list(self):
        enc, ids = filter_data([[1.0], [2.0]], [10])
        self.assertEqual(list(ids), [10])


# ---------------------------------------------------------------------------
# create_all_clusters
# ---------------------------------------------------------------------------


class CreateAllClustersTest(TestCase):
    def setUp(self):
        self.user = create_test_user()
        self.photo = create_test_photo(owner=self.user)

    def make_face(self, seed, **kwargs):
        return create_test_face(photo=self.photo, encoding=enc_hex(seed), **kwargs)

    def test_returns_zero_and_skips_clustering_without_faces(self):
        with patch.object(face_classify, "HDBSCAN") as hdbscan:
            self.assertEqual(create_all_clusters(self.user), 0)
        hdbscan.assert_not_called()

    def test_faces_of_other_users_are_ignored(self):
        other = create_test_user()
        other_photo = create_test_photo(owner=other)
        create_test_face(photo=other_photo, encoding=enc_hex(1))
        with patch.object(face_classify, "HDBSCAN") as hdbscan:
            self.assertEqual(create_all_clusters(self.user), 0)
        hdbscan.assert_not_called()

    def test_encoding_length_mismatch_is_skipped(self):
        self.make_face(1)
        self.make_face(2)
        odd = self.make_face(3)
        Face.objects.filter(pk=odd.pk).update(encoding=enc_hex(3, length=64))

        cls, instance = fake_hdbscan([0, 0])
        with (
            patch.object(face_classify, "HDBSCAN", cls),
            patch.object(
                face_classify.ClusterManager, "try_add_cluster", return_value=[]
            ),
        ):
            target = create_all_clusters(self.user)

        # Only the two faces with the first-seen encoding length are counted.
        self.assertEqual(target, 2)
        self.assertEqual(instance.fit.call_args[0][0].shape, (2, 128))

    def test_empty_encoding_string_is_skipped(self):
        self.make_face(1)
        blank = self.make_face(2)
        Face.objects.filter(pk=blank.pk).update(encoding="")

        cls, instance = fake_hdbscan([0])
        with (
            patch.object(face_classify, "HDBSCAN", cls),
            patch.object(
                face_classify.ClusterManager, "try_add_cluster", return_value=[]
            ),
        ):
            self.assertEqual(create_all_clusters(self.user), 1)

    def test_default_hdbscan_parameters_for_a_small_library(self):
        self.make_face(1)
        self.user.min_cluster_size = 0
        self.user.min_samples = 0
        self.user.cluster_selection_epsilon = 0.05
        self.user.save()

        cls, _ = fake_hdbscan([0])
        with (
            patch.object(face_classify, "HDBSCAN", cls),
            patch.object(
                face_classify.ClusterManager, "try_add_cluster", return_value=[]
            ),
        ):
            create_all_clusters(self.user)

        self.assertEqual(
            cls.call_args.kwargs,
            {
                "min_cluster_size": 2,
                "min_samples": 1,
                "cluster_selection_epsilon": 0.05,
                "metric": "euclidean",
            },
        )

    def test_user_settings_override_hdbscan_parameters(self):
        self.make_face(1)
        self.user.min_cluster_size = 7
        self.user.min_samples = 3
        self.user.cluster_selection_epsilon = 0.25
        self.user.save()

        cls, _ = fake_hdbscan([0])
        with (
            patch.object(face_classify, "HDBSCAN", cls),
            patch.object(
                face_classify.ClusterManager, "try_add_cluster", return_value=[]
            ),
        ):
            create_all_clusters(self.user)

        self.assertEqual(cls.call_args.kwargs["min_cluster_size"], 7)
        self.assertEqual(cls.call_args.kwargs["min_samples"], 3)
        self.assertEqual(cls.call_args.kwargs["cluster_selection_epsilon"], 0.25)

    def test_min_cluster_size_of_one_is_treated_as_unset(self):
        self.make_face(1)
        self.user.min_cluster_size = 1
        self.user.save()

        cls, _ = fake_hdbscan([0])
        with (
            patch.object(face_classify, "HDBSCAN", cls),
            patch.object(
                face_classify.ClusterManager, "try_add_cluster", return_value=[]
            ),
        ):
            create_all_clusters(self.user)

        self.assertEqual(cls.call_args.kwargs["min_cluster_size"], 2)

    def test_clusters_are_created_largest_first_and_numbered_from_one(self):
        faces = [self.make_face(i) for i in range(4)]
        face_ids = sorted(f.id for f in faces)

        # SQLite returns the faces in pk order, so labels line up with face_ids.
        cls, _ = fake_hdbscan([0, 0, 1, UNKNOWN_CLUSTER_ID])
        with (
            patch.object(face_classify, "HDBSCAN", cls),
            patch.object(
                face_classify.ClusterManager, "try_add_cluster", return_value=[]
            ) as try_add,
        ):
            target = create_all_clusters(self.user)

        self.assertEqual(target, 4)
        # label 0 has 2 faces (largest -> cluster id 1); the -1 label keeps its
        # own id; the remaining single-face label gets the next number.
        self.assertEqual([call.args[1] for call in try_add.call_args_list], [1, -1, 2])
        # maxLen is the digit-width of the *number of labels* (3 -> 1).
        self.assertEqual([call.args[3] for call in try_add.call_args_list], [1, 1, 1])
        self.assertEqual(
            [call.args[0] for call in try_add.call_args_list], [self.user] * 3
        )

        seen = sorted(f.id for call in try_add.call_args_list for f in call.args[2])
        self.assertEqual(seen, face_ids)

    def test_deleted_faces_count_toward_the_total_but_are_not_clustered(self):
        keep = self.make_face(1)
        gone = self.make_face(2)
        Face.objects.filter(pk=gone.pk).update(deleted=True)

        cls, _ = fake_hdbscan([0, 0])
        with (
            patch.object(face_classify, "HDBSCAN", cls),
            patch.object(
                face_classify.ClusterManager, "try_add_cluster", return_value=[]
            ) as try_add,
        ):
            target = create_all_clusters(self.user)

        # BUG-ish (pinned): deleted faces are still fed to HDBSCAN and counted
        # in the returned target, but the queryset handed to ClusterManager
        # filters them out again.
        self.assertEqual(target, 2)
        seen = [f.id for call in try_add.call_args_list for f in call.args[2]]
        self.assertEqual(seen, [keep.id])

    def test_return_value_is_the_face_count_not_the_cluster_count(self):
        for i in range(3):
            self.make_face(i)
        cluster = Cluster.objects.create(owner=self.user, cluster_id=1, name="c")

        cls, _ = fake_hdbscan([0, 0, 0])
        with (
            patch.object(face_classify, "HDBSCAN", cls),
            patch.object(
                face_classify.ClusterManager, "try_add_cluster", return_value=[cluster]
            ),
        ):
            self.assertEqual(create_all_clusters(self.user), 3)

    def test_long_running_job_is_optional_and_untouched_when_fast(self):
        self.make_face(1)
        lrj = LongRunningJob.create_job(
            self.user, LongRunningJob.JOB_CLUSTER_ALL_FACES, job_id=str(uuid.uuid4())
        )

        cls, _ = fake_hdbscan([0])
        with (
            patch.object(face_classify, "HDBSCAN", cls),
            patch.object(
                face_classify.ClusterManager, "try_add_cluster", return_value=[]
            ),
        ):
            create_all_clusters(self.user, lrj)

        lrj.refresh_from_db()
        # Progress is only written once the 5s commit window elapses.
        self.assertEqual(lrj.progress_current, 0)
        self.assertEqual(lrj.progress_target, 0)


# ---------------------------------------------------------------------------
# train_faces
# ---------------------------------------------------------------------------


class TrainFacesTestBase(TestCase):
    def setUp(self):
        FakeMLP.instances = []
        FakeMLP.PEAK_INDEX = 0
        self.user = create_test_user()
        self.photo = create_test_photo(owner=self.user)
        self.job_id = str(uuid.uuid4())

    def make_face(self, seed, **kwargs):
        return create_test_face(photo=self.photo, encoding=enc_hex(seed), **kwargs)

    def job(self):
        return LongRunningJob.objects.get(job_id=self.job_id)


class TrainFacesEmptyDataTest(TrainFacesTestBase):
    """The real MLPClassifier is used here to pin the failure path."""

    def test_no_faces_at_all_fails_the_job(self):
        # BUG-ish (pinned): with nothing to train on, the cluster classifier is
        # still fitted on an empty array, which raises and fails the job.
        self.assertFalse(train_faces(self.user, self.job_id))
        job = self.job()
        self.assertTrue(job.failed)
        self.assertTrue(job.finished)
        self.assertEqual(job.result["status"], "failed")
        self.assertEqual(job.job_type, LongRunningJob.JOB_TRAIN_FACES)

    def test_only_unknown_faces_fails_the_job(self):
        self.make_face(1)
        self.make_face(2)
        self.assertFalse(train_faces(self.user, self.job_id))
        self.assertTrue(self.job().failed)


class TrainFacesTest(TrainFacesTestBase):
    def setUp(self):
        super().setUp()
        self.p1 = create_test_person(name="Alice")
        self.p2 = create_test_person(name="Bob")
        if self.p1.id > self.p2.id:  # keep classes_[0] == p1
            self.p1, self.p2 = self.p2, self.p1

    def test_known_faces_only_completes_without_predicting(self):
        self.make_face(1, person=self.p1)
        self.make_face(2, person=self.p2)

        with patch.object(face_classify, "MLPClassifier", FakeMLP):
            self.assertTrue(train_faces(self.user, self.job_id))

        job = self.job()
        self.assertTrue(job.finished)
        self.assertFalse(job.failed)
        self.assertEqual(job.progress_current, 2)
        self.assertEqual(job.progress_target, 2)
        # Two classifiers are always constructed when known faces exist.
        self.assertEqual(len(FakeMLP.instances), 2)
        self.assertEqual(
            FakeMLP.instances[0].kwargs,
            {"solver": "adam", "alpha": 1e-5, "random_state": 1, "max_iter": 1000},
        )

    def test_unknown_face_gets_cluster_and_classification_person(self):
        self.make_face(1, person=self.p1)
        self.make_face(2, person=self.p2)
        unknown = self.make_face(3)

        with patch.object(face_classify, "MLPClassifier", FakeMLP):
            self.assertTrue(train_faces(self.user, self.job_id))

        unknown.refresh_from_db()
        self.assertEqual(unknown.cluster_person_id, self.p1.id)
        self.assertAlmostEqual(unknown.cluster_probability, FakeMLP.PEAK_VALUE)
        self.assertEqual(unknown.classification_person_id, self.p1.id)
        self.assertAlmostEqual(unknown.classification_probability, FakeMLP.PEAK_VALUE)

        job = self.job()
        self.assertTrue(job.finished)
        self.assertFalse(job.failed)
        self.assertEqual(job.progress_target, 1)

    def test_highest_probability_class_wins(self):
        self.make_face(1, person=self.p1)
        self.make_face(2, person=self.p2)
        unknown = self.make_face(3)

        FakeMLP.PEAK_INDEX = 1  # second class -> p2
        with patch.object(face_classify, "MLPClassifier", FakeMLP):
            train_faces(self.user, self.job_id)

        unknown.refresh_from_db()
        self.assertEqual(unknown.cluster_person_id, self.p2.id)
        self.assertEqual(unknown.classification_person_id, self.p2.id)

    def test_face_already_in_the_unknown_cluster_keeps_no_cluster_person(self):
        self.make_face(1, person=self.p1)
        self.make_face(2, person=self.p2)
        unknown_cluster = get_unknown_cluster(user=self.user)
        unknown = self.make_face(3, cluster=unknown_cluster)

        with patch.object(face_classify, "MLPClassifier", FakeMLP):
            self.assertTrue(train_faces(self.user, self.job_id))

        unknown.refresh_from_db()
        self.assertIsNone(unknown.cluster_person_id)
        self.assertEqual(unknown.cluster_probability, 0.0)
        # Classification still runs for faces in the unknown cluster.
        self.assertEqual(unknown.classification_person_id, self.p1.id)

    def test_deleted_and_empty_encoding_faces_are_ignored(self):
        self.make_face(1, person=self.p1)
        self.make_face(2, person=self.p2)
        deleted = self.make_face(3, deleted=True)
        blank = self.make_face(4)
        Face.objects.filter(pk=blank.pk).update(encoding="")
        kept = self.make_face(5)

        with patch.object(face_classify, "MLPClassifier", FakeMLP):
            self.assertTrue(train_faces(self.user, self.job_id))

        self.assertEqual(self.job().progress_target, 1)
        kept.refresh_from_db()
        deleted.refresh_from_db()
        blank.refresh_from_db()
        self.assertEqual(kept.cluster_person_id, self.p1.id)
        self.assertIsNone(deleted.cluster_person_id)
        self.assertIsNone(blank.cluster_person_id)

    def test_faces_of_other_users_are_not_touched(self):
        self.make_face(1, person=self.p1)
        self.make_face(2, person=self.p2)
        other = create_test_user()
        other_photo = create_test_photo(owner=other)
        foreign = create_test_face(photo=other_photo, encoding=enc_hex(9))

        with patch.object(face_classify, "MLPClassifier", FakeMLP):
            self.assertTrue(train_faces(self.user, self.job_id))

        foreign.refresh_from_db()
        self.assertIsNone(foreign.cluster_person_id)

    def test_cluster_person_centroids_join_the_training_set(self):
        self.make_face(1, person=self.p1)
        self.make_face(2, person=self.p2)
        cluster_person = create_test_person(
            name="Unknown 1", kind=Person.KIND_CLUSTER, cluster_owner=self.user
        )
        Cluster.objects.create(
            owner=self.user,
            cluster_id=1,
            name="Cluster 1",
            person=cluster_person,
            mean_face_encoding=enc_hex(42),
        )
        # A cluster whose person is a normal user person is *not* added.
        Cluster.objects.create(
            owner=self.user,
            cluster_id=2,
            name="Cluster 2",
            person=self.p1,
            mean_face_encoding=enc_hex(43),
        )

        with patch.object(face_classify, "MLPClassifier", FakeMLP):
            self.assertTrue(train_faces(self.user, self.job_id))

        first, second = FakeMLP.instances
        self.assertEqual(sorted(first.fit_y.tolist()), [self.p1.id, self.p2.id])
        self.assertEqual(
            sorted(second.fit_y.tolist()),
            sorted([self.p1.id, self.p2.id, cluster_person.id]),
        )

    def test_classifier_failure_fails_the_job_and_returns_false(self):
        self.make_face(1, person=self.p1)
        self.make_face(2, person=self.p2)
        self.make_face(3)

        boom = MagicMock(side_effect=RuntimeError("boom"))
        with patch.object(face_classify, "MLPClassifier", boom):
            self.assertFalse(train_faces(self.user, self.job_id))

        job = self.job()
        self.assertTrue(job.failed)
        self.assertTrue(job.finished)
        self.assertEqual(job.result, {"status": "failed", "error": "boom"})

    def test_existing_job_is_reused(self):
        existing = LongRunningJob.create_job(
            self.user, LongRunningJob.JOB_TRAIN_FACES, job_id=self.job_id
        )
        self.make_face(1, person=self.p1)
        self.make_face(2, person=self.p2)

        with patch.object(face_classify, "MLPClassifier", FakeMLP):
            train_faces(self.user, self.job_id)

        self.assertEqual(LongRunningJob.objects.filter(job_id=self.job_id).count(), 1)
        existing.refresh_from_db()
        self.assertTrue(existing.finished)
