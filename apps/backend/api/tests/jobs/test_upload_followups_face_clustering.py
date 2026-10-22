"""The upload follow-ups cluster new faces, with a threshold and quiet periods (#2738).

New faces from uploads sat among the unknown faces until someone reclustered
by hand. ``cluster_new_faces`` queues Find Similar Faces once enough of them
arrived, at most hourly, and not while the user uploads, labels faces or runs
a face job, because a rebuild deletes and renumbers the user's clusters.
"""

from datetime import timedelta
from unittest import mock

from django.test import TestCase
from django.utils import timezone
from django_q.models import Schedule

from api.faces.classify import cluster_all_faces
from api.faces.clustering_gate import (
    BUSY_RETRY,
    CLUSTER_INTERVAL,
    LABEL_QUIET,
    UPLOAD_QUIET,
    latest_face_id,
    record_clustering,
)
from api.faces.labels import delete_faces, relabel_faces
from api.jobs.upload_followups import (
    FollowupRun,
    cluster_new_faces,
    run_upload_followups,
)
from api.models import Face, LongRunningJob, UploadFollowupState
from api.tests.utils import (
    create_test_cluster,
    create_test_face,
    create_test_job,
    create_test_person,
    create_test_photo,
    create_test_upload_followup_state,
    create_test_user,
)

FACES_PER_PHOTO = 50


def _schedules(user):
    return Schedule.objects.filter(name=f"upload-followups-{user.id}")


def _state(user):
    return UploadFollowupState.objects.get_owned(user, pk=user.pk)


def _add_faces(owner, count, **kwargs):
    """``count`` encoded faces on photos of ``owner``'s; the last one."""
    face = None
    for start in range(0, count, FACES_PER_PHOTO):
        photo = create_test_photo(owner=owner)
        for _ in range(min(FACES_PER_PHOTO, count - start)):
            face = create_test_face(photo=photo, **kwargs)
    return face


class ClusterNewFacesTestBase(TestCase):
    def setUp(self):
        self.user = create_test_user()
        create_test_upload_followup_state(self.user)
        self.features = self._patch("feature_enabled", return_value=True)
        self.enqueue = self._patch("enqueue_followup")

    def _patch(self, name, **kwargs):
        patcher = mock.patch(f"api.jobs.upload_followups.{name}", **kwargs)
        self.addCleanup(patcher.stop)
        return patcher.start()

    def _library(self, old, new, clustered_ago=timedelta(hours=2)):
        """``old`` faces a clustering ``clustered_ago`` saw, then ``new`` ones."""
        _add_faces(self.user, old)
        record_clustering(self.user, latest_face_id(self.user))
        UploadFollowupState.objects.owned_by(self.user).update(
            last_clustered_at=timezone.now() - clustered_ago
        )
        _add_faces(self.user, new)

    def _step(self):
        cluster_new_faces(
            FollowupRun(user=self.user, photos_added=True, heartbeat=lambda: True)
        )

    def assertQueuedOnce(self):
        self.enqueue.assert_called_once_with(
            self.user,
            LongRunningJob.JOB_CLUSTER_ALL_FACES,
            cluster_all_faces,
            self.user,
        )
        self.assertFalse(_schedules(self.user).exists())

    def assertNothing(self):
        self.enqueue.assert_not_called()
        self.assertFalse(_schedules(self.user).exists())

    def assertRearmedFor(self, at):
        self.enqueue.assert_not_called()
        self.assertEqual([at], [s.next_run for s in _schedules(self.user)])


class ThresholdTest(ClusterNewFacesTestBase):
    def test_25_new_faces_in_a_library_of_500_queue_one_clustering(self):
        self._library(old=475, new=25)

        self._step()

        self.assertQueuedOnce()

    def test_5_new_faces_do_not(self):
        self._library(old=475, new=5)

        self._step()

        self.assertNothing()

    def test_in_a_large_library_the_share_of_new_faces_counts(self):
        self._library(old=475, new=25)

        with mock.patch("api.faces.clustering_gate.NEW_FACE_SHARE", 0.1):
            self._step()

        self.assertNothing()

    def test_deleted_and_unencoded_faces_are_not_counted(self):
        self._library(old=0, new=15)
        _add_faces(self.user, 10, deleted=True)
        unencoded = _add_faces(self.user, 10)
        Face.objects.filter(photo=unencoded.photo).update(encoding="")

        self._step()

        self.assertNothing()

    def test_another_users_new_faces_are_not_counted(self):
        self._library(old=100, new=5)
        _add_faces(create_test_user(), 30)

        self._step()

        self.assertNothing()

    def test_nothing_while_face_detection_or_clustering_is_off(self):
        self._library(old=0, new=25)
        for off in ("FACE_DETECTION", "FACE_CLUSTER"):
            with self.subTest(off=off):
                self.features.side_effect = lambda name, off=off: name != off

                self._step()

                self.assertNothing()


class WatermarkBeforeTheFirstClusteringTest(ClusterNewFacesTestBase):
    """States from before #2738 carry no watermark."""

    def test_faces_a_clustering_placed_count_as_seen(self):
        _add_faces(self.user, 30, cluster=create_test_cluster(self.user))
        _add_faces(self.user, 5)

        self._step()

        self.assertNothing()

    def test_a_library_never_clustered_is_all_new(self):
        _add_faces(self.user, 25)

        self._step()

        self.assertQueuedOnce()


class QuietPeriodTest(ClusterNewFacesTestBase):
    def test_a_clustering_less_than_an_hour_ago_rearms_the_run(self):
        self._library(old=0, new=25, clustered_ago=timedelta(minutes=20))

        self._step()

        self.assertRearmedFor(_state(self.user).last_clustered_at + CLUSTER_INTERVAL)

    def test_labelling_a_face_postpones_the_run_by_15_minutes(self):
        self._library(old=0, new=25)
        face = Face.objects.owned_by(self.user).first()

        relabel_faces(
            self.user,
            Face.objects.owned_by(self.user).filter(pk=face.pk),
            create_test_person(cluster_owner=self.user, name="Alice"),
        )
        self._step()

        self.assertRearmedFor(_state(self.user).last_face_label_at + LABEL_QUIET)

    def test_a_label_older_than_15_minutes_holds_nothing_back(self):
        self._library(old=0, new=25)
        UploadFollowupState.objects.owned_by(self.user).update(
            last_face_label_at=timezone.now() - LABEL_QUIET - timedelta(seconds=1)
        )

        self._step()

        self.assertQueuedOnce()

    def test_an_upload_less_than_30_minutes_ago_rearms_the_run(self):
        self._library(old=0, new=25)
        last_file_at = timezone.now() - timedelta(minutes=10)
        create_test_job(
            self.user,
            LongRunningJob.JOB_IMPORT_UPLOADS,
            finished=True,
            last_file_at=last_file_at,
        )

        self._step()

        self.assertRearmedFor(last_file_at + UPLOAD_QUIET)

    def test_the_waits_add_up_to_the_latest_of_them(self):
        self._library(old=0, new=25, clustered_ago=timedelta(minutes=50))
        last_file_at = timezone.now() - timedelta(minutes=5)
        create_test_job(
            self.user,
            LongRunningJob.JOB_IMPORT_UPLOADS,
            finished=True,
            last_file_at=last_file_at,
        )

        self._step()

        self.assertRearmedFor(last_file_at + UPLOAD_QUIET)

    def test_another_users_upload_holds_nothing_back(self):
        self._library(old=0, new=25)
        create_test_job(
            create_test_user(),
            LongRunningJob.JOB_IMPORT_UPLOADS,
            last_file_at=timezone.now(),
        )

        self._step()

        self.assertQueuedOnce()


class BusyJobTest(ClusterNewFacesTestBase):
    def test_a_running_face_job_rearms_the_run(self):
        self._library(old=0, new=25)
        for job_type in (
            LongRunningJob.JOB_SCAN_PHOTOS,
            LongRunningJob.JOB_SCAN_FACES,
            LongRunningJob.JOB_CLUSTER_ALL_FACES,
            LongRunningJob.JOB_TRAIN_FACES,
        ):
            with self.subTest(job_type=job_type):
                job = create_test_job(self.user, job_type)
                before = timezone.now()

                self._step()

                self.enqueue.assert_not_called()
                next_run = _schedules(self.user).get().next_run
                self.assertLessEqual(before + BUSY_RETRY, next_run)
                self.assertLessEqual(next_run, timezone.now() + BUSY_RETRY)
                job.delete()
                _schedules(self.user).delete()

    def test_an_open_upload_import_rearms_the_run(self):
        self._library(old=0, new=25)
        create_test_job(
            self.user,
            LongRunningJob.JOB_IMPORT_UPLOADS,
            sealed=False,
            last_file_at=timezone.now() - UPLOAD_QUIET - timedelta(minutes=1),
        )

        self._step()

        self.enqueue.assert_not_called()
        self.assertGreater(_schedules(self.user).get().next_run, timezone.now())

    def test_a_finished_job_or_another_users_holds_nothing_back(self):
        self._library(old=0, new=25)
        create_test_job(self.user, LongRunningJob.JOB_SCAN_FACES, finished=True)
        create_test_job(create_test_user(), LongRunningJob.JOB_CLUSTER_ALL_FACES)

        self._step()

        self.assertQueuedOnce()


class ClusteringMovesTheWatermarkTest(ClusterNewFacesTestBase):
    def setUp(self):
        super().setUp()
        for name, kwargs in (
            ("feature_enabled", {"return_value": True}),
            ("create_all_clusters", {"return_value": 0}),
            ("enqueue_followup", {}),
        ):
            patcher = mock.patch(f"api.faces.classify.{name}", **kwargs)
            self.addCleanup(patcher.stop)
            setattr(self, f"classify_{name}", patcher.start())

    def test_a_scans_own_clustering_is_not_repeated_by_the_follow_ups(self):
        last = _add_faces(self.user, 25)

        self.assertTrue(cluster_all_faces(self.user))
        self._step()

        state = _state(self.user)
        self.assertEqual(last.pk, state.face_watermark)
        self.assertIsNotNone(state.last_clustered_at)
        self.assertNothing()

    def test_a_face_added_while_it_clusters_stays_new(self):
        last = _add_faces(self.user, 5)

        def add_a_face(user, lrj):
            _add_faces(self.user, 1)
            return 0

        self.classify_create_all_clusters.side_effect = add_a_face

        cluster_all_faces(self.user)

        self.assertEqual(last.pk, _state(self.user).face_watermark)

    def test_a_failed_clustering_leaves_the_watermark(self):
        _add_faces(self.user, 5)
        self.classify_create_all_clusters.side_effect = RuntimeError("hdbscan")

        self.assertFalse(cluster_all_faces(self.user))

        state = _state(self.user)
        self.assertEqual((0, None), (state.face_watermark, state.last_clustered_at))


class FaceLabellingIsRecordedTest(TestCase):
    def setUp(self):
        self.user = create_test_user()
        self.face = _add_faces(self.user, 1)

    def test_deleting_faces_counts_as_labelling(self):
        delete_faces(self.user, [self.face.pk])

        self.assertIsNotNone(_state(self.user).last_face_label_at)

    def test_a_labelling_that_touched_no_face_records_nothing(self):
        stranger = create_test_user()

        relabel_faces(stranger, Face.objects.filter(pk=self.face.pk), None)

        self.assertFalse(UploadFollowupState.objects.owned_by(stranger).exists())


class RunUploadFollowupsClustersTest(ClusterNewFacesTestBase):
    def test_the_run_clusters_after_encoding_the_faces(self):
        for name in (
            "batch_calculate_clip_embedding",
            "build_image_similarity_index",
            "generate_face_embeddings",
        ):
            self._patch(name)
        _add_faces(self.user, 25)

        run_upload_followups(self.user.id)

        self.assertQueuedOnce()
