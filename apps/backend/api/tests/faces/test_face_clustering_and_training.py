"""Characterization tests for ``api.faces.classify`` (unit 10).

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
Deleted faces no longer reach HDBSCAN (#2748), and training with nothing to
learn completes instead of failing (#2733).
"""

import datetime
import itertools
import uuid
from contextlib import contextmanager
from unittest.mock import MagicMock, patch

import numpy as np
from django.test import TestCase, override_settings

from api.faces import classify
from api.faces.classify import (
    cluster_all_faces,
    create_all_clusters,
    filter_data,
    train_faces,
)
from api.models import Face, LongRunningJob, Person
from api.models.cluster import UNKNOWN_CLUSTER_ID, get_unknown_cluster
from api.tests.utils import (
    create_test_cluster,
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

    instances: list[FakeMLP] = []
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
        with patch.object(classify, "make_hdbscan") as hdbscan:
            self.assertEqual(create_all_clusters(self.user), 0)
        hdbscan.assert_not_called()

    def test_faces_of_other_users_are_ignored(self):
        other = create_test_user()
        other_photo = create_test_photo(owner=other)
        create_test_face(photo=other_photo, encoding=enc_hex(1))
        with patch.object(classify, "make_hdbscan") as hdbscan:
            self.assertEqual(create_all_clusters(self.user), 0)
        hdbscan.assert_not_called()

    def test_encoding_length_mismatch_is_skipped(self):
        self.make_face(1)
        self.make_face(2)
        odd = self.make_face(3)
        Face.objects.filter(pk=odd.pk).update(encoding=enc_hex(3, length=64))

        cls, instance = fake_hdbscan([0, 0])
        with (
            patch.object(classify, "make_hdbscan", cls),
            patch.object(classify.ClusterManager, "try_add_cluster", return_value=[]),
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
            patch.object(classify, "make_hdbscan", cls),
            patch.object(classify.ClusterManager, "try_add_cluster", return_value=[]),
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
            patch.object(classify, "make_hdbscan", cls),
            patch.object(classify.ClusterManager, "try_add_cluster", return_value=[]),
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
            patch.object(classify, "make_hdbscan", cls),
            patch.object(classify.ClusterManager, "try_add_cluster", return_value=[]),
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
            patch.object(classify, "make_hdbscan", cls),
            patch.object(classify.ClusterManager, "try_add_cluster", return_value=[]),
        ):
            create_all_clusters(self.user)

        self.assertEqual(cls.call_args.kwargs["min_cluster_size"], 2)

    def test_clusters_are_created_largest_first_and_numbered_from_one(self):
        faces = [self.make_face(i) for i in range(4)]
        face_ids = sorted(f.id for f in faces)

        # SQLite returns the faces in pk order, so labels line up with face_ids.
        cls, _ = fake_hdbscan([0, 0, 1, UNKNOWN_CLUSTER_ID])
        with (
            patch.object(classify, "make_hdbscan", cls),
            patch.object(
                classify.ClusterManager, "try_add_cluster", return_value=[]
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

    def test_deleted_faces_are_neither_fitted_nor_clustered(self):
        keep = self.make_face(1)
        gone = self.make_face(2)
        Face.objects.filter(pk=gone.pk).update(deleted=True)

        cls, instance = fake_hdbscan([0])
        with (
            patch.object(classify, "make_hdbscan", cls),
            patch.object(
                classify.ClusterManager, "try_add_cluster", return_value=[]
            ) as try_add,
        ):
            target = create_all_clusters(self.user)

        # A deleted face does not shape the clusters of the real ones (#2748).
        self.assertEqual(target, 1)
        self.assertEqual(instance.fit.call_args[0][0].shape, (1, 128))
        seen = [f.id for call in try_add.call_args_list for f in call.args[2]]
        self.assertEqual(seen, [keep.id])

    def test_return_value_is_the_face_count_not_the_cluster_count(self):
        for i in range(3):
            self.make_face(i)
        cluster = create_test_cluster(owner=self.user, cluster_id=1, name="c")

        cls, _ = fake_hdbscan([0, 0, 0])
        with (
            patch.object(classify, "make_hdbscan", cls),
            patch.object(
                classify.ClusterManager, "try_add_cluster", return_value=[cluster]
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
            patch.object(classify, "make_hdbscan", cls),
            patch.object(classify.ClusterManager, "try_add_cluster", return_value=[]),
        ):
            create_all_clusters(self.user, lrj)

        lrj.refresh_from_db()
        # Progress is only written once the 5s commit window elapses.
        self.assertEqual(lrj.progress_current, 0)
        self.assertEqual(lrj.progress_target, 0)


def clock_past_every_deadline():
    """Stands in for the ``datetime`` module of ``classify``: every ``now()`` is a
    minute after the previous one, so each loop pass is past its commit time and
    reports progress."""
    start = datetime.datetime(2026, 1, 1)
    clock = MagicMock()
    clock.timedelta = datetime.timedelta
    clock.datetime.now.side_effect = (
        start + datetime.timedelta(minutes=i) for i in itertools.count()
    )
    return clock


class CancelDuringClusteringTest(TestCase):
    """A cancel from the job list while the clusters are being created (#2334).

    Progress used to be written with a full-row ``lrj.save()`` of the instance
    loaded when the job started, which put ``cancelled=False, finished=False``
    back on the next progress tick: the job reappeared as running.
    """

    def setUp(self):
        self.user = create_test_user()
        self.photo = create_test_photo(owner=self.user)
        for seed in range(3):
            create_test_face(photo=self.photo, encoding=enc_hex(seed))
        self.job_id = str(uuid.uuid4())
        LongRunningJob.create_job(
            self.user, LongRunningJob.JOB_CLUSTER_ALL_FACES, job_id=self.job_id
        )

    def job(self):
        return LongRunningJob.objects.get(job_id=self.job_id)

    def cancel_on_first_cluster(self):
        def try_add_cluster(*args):
            if try_add.call_count == 1:
                self.job().cancel()
            return []

        try_add = MagicMock(side_effect=try_add_cluster)
        return try_add

    @contextmanager
    def clustering(self):
        """Two clusters, a clock past every deadline, a cancel on the first one."""
        cls, _ = fake_hdbscan([0, 0, 1])
        try_add = self.cancel_on_first_cluster()
        with (
            patch.object(classify, "make_hdbscan", cls),
            patch.object(classify, "datetime", clock_past_every_deadline()),
            patch.object(classify.ClusterManager, "try_add_cluster", try_add),
        ):
            yield try_add

    def assert_still_cancelled(self):
        job = self.job()
        self.assertTrue(job.cancelled)
        self.assertTrue(job.finished)
        self.assertFalse(job.failed)
        self.assertEqual(job.result, {"status": "cancelled"})

    def test_progress_tick_keeps_the_cancel(self):
        lrj = LongRunningJob.claim(
            self.user, LongRunningJob.JOB_CLUSTER_ALL_FACES, self.job_id
        )
        with self.clustering() as try_add:
            create_all_clusters(self.user, lrj)

        self.assertEqual(try_add.call_count, 2)
        self.assert_still_cancelled()
        # The progress itself is still reported.
        self.assertEqual(self.job().progress_current, 3)
        self.assertEqual(self.job().progress_target, 3)

    @override_settings(FEATURE_FACE_CLUSTER=True)
    @patch("api.faces.classify.enqueue_followup")
    def test_cancelled_clustering_is_not_completed_or_followed_by_training(
        self, enqueue
    ):
        with self.clustering():
            cluster_all_faces(self.user, self.job_id)

        self.assert_still_cancelled()
        enqueue.assert_not_called()


@override_settings(FEATURE_FACE_CLUSTER=True)
class FaceJobsLetInterruptsThroughTest(TestCase):
    """``except BaseException`` turned a KeyboardInterrupt or SystemExit (a worker
    being stopped) into a failed job and swallowed it (#2334)."""

    def setUp(self):
        self.user = create_test_user()
        self.job_id = str(uuid.uuid4())

    def job(self):
        return LongRunningJob.objects.get(job_id=self.job_id)

    def test_keyboard_interrupt_while_clustering_propagates(self):
        LongRunningJob.create_job(
            self.user, LongRunningJob.JOB_CLUSTER_ALL_FACES, job_id=self.job_id
        )
        with (
            patch.object(
                classify, "create_all_clusters", side_effect=KeyboardInterrupt
            ),
            self.assertRaises(KeyboardInterrupt),
        ):
            cluster_all_faces(self.user, self.job_id)
        self.assertFalse(self.job().failed)
        self.assertFalse(self.job().finished)

    def test_system_exit_while_training_propagates(self):
        LongRunningJob.create_job(
            self.user, LongRunningJob.JOB_TRAIN_FACES, job_id=self.job_id
        )
        with (
            patch.object(classify, "split_faces_by_label", side_effect=SystemExit),
            self.assertRaises(SystemExit),
        ):
            train_faces(self.user, self.job_id)
        self.assertFalse(self.job().failed)
        self.assertFalse(self.job().finished)

    def test_an_ordinary_error_still_fails_the_clustering_job(self):
        LongRunningJob.create_job(
            self.user, LongRunningJob.JOB_CLUSTER_ALL_FACES, job_id=self.job_id
        )
        with patch.object(
            classify, "create_all_clusters", side_effect=RuntimeError("boom")
        ):
            self.assertFalse(cluster_all_faces(self.user, self.job_id))
        self.assertTrue(self.job().failed)
        self.assertEqual(self.job().result, {"status": "failed", "error": "boom"})


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
    """The real MLPClassifier: with no class to learn, it is not fitted (#2733)."""

    def test_no_faces_at_all_completes_with_nothing_to_train(self):
        self.assertTrue(train_faces(self.user, self.job_id))
        job = self.job()
        self.assertFalse(job.failed)
        self.assertTrue(job.finished)
        self.assertEqual(job.result, {"status": "completed", "nothing_to_train": True})
        self.assertEqual(job.job_type, LongRunningJob.JOB_TRAIN_FACES)

    def test_only_unknown_faces_completes_with_nothing_to_train(self):
        self.make_face(1)
        self.make_face(2)
        self.assertTrue(train_faces(self.user, self.job_id))
        self.assertFalse(self.job().failed)


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

        with patch.object(classify, "make_mlp_classifier", FakeMLP):
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

        with patch.object(classify, "make_mlp_classifier", FakeMLP):
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
        with patch.object(classify, "make_mlp_classifier", FakeMLP):
            train_faces(self.user, self.job_id)

        unknown.refresh_from_db()
        self.assertEqual(unknown.cluster_person_id, self.p2.id)
        self.assertEqual(unknown.classification_person_id, self.p2.id)

    def test_face_already_in_the_unknown_cluster_keeps_no_cluster_person(self):
        self.make_face(1, person=self.p1)
        self.make_face(2, person=self.p2)
        unknown_cluster = get_unknown_cluster(user=self.user)
        unknown = self.make_face(3, cluster=unknown_cluster)

        with patch.object(classify, "make_mlp_classifier", FakeMLP):
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

        with patch.object(classify, "make_mlp_classifier", FakeMLP):
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

        with patch.object(classify, "make_mlp_classifier", FakeMLP):
            self.assertTrue(train_faces(self.user, self.job_id))

        foreign.refresh_from_db()
        self.assertIsNone(foreign.cluster_person_id)

    def test_cluster_person_centroids_join_the_training_set(self):
        self.make_face(1, person=self.p1)
        self.make_face(2, person=self.p2)
        cluster_person = create_test_person(
            name="Unknown 1", kind=Person.KIND_CLUSTER, cluster_owner=self.user
        )
        create_test_cluster(
            owner=self.user,
            cluster_id=1,
            name="Cluster 1",
            person=cluster_person,
            mean_face_encoding=enc_hex(42),
        )
        # A cluster whose person is a normal user person is *not* added.
        create_test_cluster(
            owner=self.user,
            cluster_id=2,
            name="Cluster 2",
            person=self.p1,
            mean_face_encoding=enc_hex(43),
        )

        with patch.object(classify, "make_mlp_classifier", FakeMLP):
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
        with patch.object(classify, "make_mlp_classifier", boom):
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

        with patch.object(classify, "make_mlp_classifier", FakeMLP):
            train_faces(self.user, self.job_id)

        self.assertEqual(LongRunningJob.objects.filter(job_id=self.job_id).count(), 1)
        existing.refresh_from_db()
        self.assertTrue(existing.finished)
