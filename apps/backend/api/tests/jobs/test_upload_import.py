"""The upload import job: one open job per user counts its uploads (#2737).

Uploads had no job, so nothing could show "processing 12 of 40" and per-file
errors were lost. The job is sealed when the client's queue drains or after a
few idle minutes, finishes when every counted file was processed, and then
requests the user's follow-ups.
"""

from datetime import timedelta
from unittest import mock

from django.core.management import call_command
from django.db import IntegrityError, transaction
from django.test import TestCase, TransactionTestCase
from django.utils import timezone
from django_q.brokers import get_broker
from django_q.models import Schedule
from rest_framework.test import APIClient

from api.jobs import upload_import
from api.jobs.queue import tasks_are_waiting
from api.jobs.upload_import import (
    FAILED_FILES_KEPT,
    IDLE_SEAL,
    LOST_AFTER,
    SWEEP_FUNC,
    UPLOAD_STEPS,
    UploadOutcome,
    attach_upload,
    import_uploaded_photo,
    record_upload,
    release_upload,
    seal_upload_imports,
    sweep_upload_imports,
)
from api.models import LongRunningJob, Photo
from api.models.long_running_job import LongRunningJobQuerySet
from api.tests.utils import create_test_job, create_test_photo, create_test_user

J = LongRunningJob
FOLLOWUPS = "api.jobs.upload_import.request_upload_followups"


def _job(job):
    return J.objects.get(pk=job.pk)


def _open_import(user, **fields):
    """An open import job of ``user`` counting ``progress_target`` files."""
    fields.setdefault("progress_target", 1)
    fields.setdefault("last_file_at", timezone.now())
    return create_test_job(
        started_by=user, job_type=J.JOB_IMPORT_UPLOADS, sealed=False, **fields
    )


class AttachUploadTest(TestCase):
    def setUp(self):
        self.user = create_test_user()

    def test_the_first_upload_opens_a_job_counting_it(self):
        job = _job(attach_upload(self.user))

        self.assertEqual(J.JOB_IMPORT_UPLOADS, job.job_type)
        self.assertFalse(job.sealed)
        self.assertFalse(job.finished)
        self.assertEqual(1, job.progress_target)
        self.assertIsNotNone(job.started_at)
        self.assertIsNotNone(job.last_file_at)

    def test_later_uploads_are_counted_in_the_same_job(self):
        first = attach_upload(self.user)
        second = attach_upload(self.user)

        self.assertEqual(first.pk, second.pk)
        self.assertEqual(2, _job(first).progress_target)

    def test_an_upload_after_the_seal_opens_a_new_job(self):
        first = attach_upload(self.user)
        seal_upload_imports(J.objects.owned_by(self.user))

        second = attach_upload(self.user)

        self.assertNotEqual(first.pk, second.pk)
        self.assertEqual(1, _job(second).progress_target)

    def test_each_user_has_their_own_job(self):
        other = create_test_user()

        mine = attach_upload(self.user)
        theirs = attach_upload(other)

        self.assertNotEqual(mine.pk, theirs.pk)
        self.assertEqual(other, _job(theirs).started_by)

    def test_the_database_allows_one_open_job_per_user(self):
        _open_import(self.user)

        with self.assertRaises(IntegrityError), transaction.atomic():
            _open_import(self.user)

    def test_a_concurrent_first_upload_attaches_to_the_job_that_won(self):
        winner = _open_import(self.user)
        # This request read "no open job" before the winner's insert landed.
        real = upload_import._count_in_open_job
        calls = iter([None])

        def racing(user, now):
            return next(calls, None) or real(user, now)

        with mock.patch.object(upload_import, "_count_in_open_job", racing):
            job = attach_upload(self.user)

        self.assertEqual(winner.pk, job.pk)
        self.assertEqual(2, _job(winner).progress_target)
        self.assertEqual(1, J.objects.owned_by(self.user).count())

    def test_a_job_sealed_while_attaching_leaves_the_upload_to_a_new_job(self):
        sealed_meanwhile = _open_import(self.user)
        real_first = LongRunningJobQuerySet.first

        def read_then_seal(queryset):
            found = real_first(queryset)
            J.objects.filter(pk=sealed_meanwhile.pk).update(sealed=True)
            return found

        with mock.patch.object(LongRunningJobQuerySet, "first", read_then_seal):
            job = attach_upload(self.user)

        self.assertNotEqual(sealed_meanwhile.pk, job.pk)
        self.assertEqual(1, _job(sealed_meanwhile).progress_target)
        self.assertEqual(1, _job(job).progress_target)

    def test_a_released_upload_is_taken_back_and_can_finish_the_job(self):
        job = _open_import(self.user, progress_target=2, progress_current=1)
        J.objects.filter(pk=job.pk).update(sealed=True)

        with mock.patch(FOLLOWUPS):
            release_upload(job.job_id)

        job = _job(job)
        self.assertEqual(1, job.progress_target)
        self.assertTrue(job.finished)


class SealTest(TestCase):
    def setUp(self):
        self.user = create_test_user()
        patcher = mock.patch(FOLLOWUPS)
        self.followups = patcher.start()
        self.addCleanup(patcher.stop)

    def test_an_unsealed_job_does_not_finish_when_its_files_are_done(self):
        job = attach_upload(self.user)

        record_upload(job.job_id, UploadOutcome("p1", "/x/a.jpg", done=["media"]))

        job = _job(job)
        self.assertEqual(1, job.progress_current)
        self.assertFalse(job.finished)
        self.followups.assert_not_called()

    def test_sealing_a_done_job_finishes_it_and_requests_the_follow_ups(self):
        job = attach_upload(self.user)
        record_upload(job.job_id, UploadOutcome("p1", "/x/a.jpg", done=["media"]))

        sealed = seal_upload_imports(J.objects.owned_by(self.user))

        self.assertEqual([job.job_id], sealed)
        job = _job(job)
        self.assertTrue(job.sealed)
        self.assertTrue(job.finished)
        self.followups.assert_called_once_with(self.user)
        self.assertTrue(job.result["followups_requested"])

    def test_a_sealed_job_finishes_with_its_last_file(self):
        job = attach_upload(self.user)
        attach_upload(self.user)
        seal_upload_imports(J.objects.owned_by(self.user))
        record_upload(job.job_id, UploadOutcome("p1", "/x/a.jpg"))
        self.assertFalse(_job(job).finished)

        record_upload(job.job_id, UploadOutcome("p2", "/x/b.jpg"))

        self.assertTrue(_job(job).finished)
        self.followups.assert_called_once_with(self.user)

    def test_a_finished_or_sealed_job_is_not_sealed_again(self):
        job = attach_upload(self.user)
        seal_upload_imports(J.objects.owned_by(self.user))

        self.assertEqual([], seal_upload_imports(J.objects.owned_by(self.user)))
        self.assertEqual(J.JOB_IMPORT_UPLOADS, _job(job).job_type)

    def test_other_job_types_are_never_sealed_or_finished(self):
        scan = create_test_job(started_by=self.user, sealed=False)

        self.assertEqual([], seal_upload_imports(J.objects.owned_by(self.user)))
        self.assertFalse(_job(scan).sealed)

    def test_a_deleted_users_job_requests_no_follow_ups(self):
        job = attach_upload(self.user)
        record_upload(job.job_id, UploadOutcome("p1", "/x/a.jpg"))
        J.objects.filter(pk=job.pk).update(sealed=True)
        self.user.is_active = False
        self.user.save()

        upload_import.on_import_finished(job.job_id, self.user.pk)
        upload_import.on_import_finished(job.job_id, None)

        self.followups.assert_not_called()


class SweepTest(TestCase):
    def setUp(self):
        self.user = create_test_user()
        patcher = mock.patch(FOLLOWUPS)
        self.followups = patcher.start()
        self.addCleanup(patcher.stop)
        waiting = mock.patch.object(
            upload_import, "tasks_are_waiting", return_value=False
        )
        self.waiting = waiting.start()
        self.addCleanup(waiting.stop)

    def test_seals_an_idle_job_and_finishes_it_when_done(self):
        idle = timezone.now() - IDLE_SEAL - timedelta(seconds=5)
        job = _open_import(self.user, progress_current=1, last_file_at=idle)

        sweep_upload_imports()

        job = _job(job)
        self.assertTrue(job.sealed)
        self.assertTrue(job.finished)
        self.followups.assert_called_once_with(self.user)

    def test_leaves_a_job_that_took_a_file_recently_open(self):
        job = _open_import(self.user, last_file_at=timezone.now())

        sweep_upload_imports()

        self.assertFalse(_job(job).sealed)

    def _lost_job(self, **fields):
        long_ago = timezone.now() - LOST_AFTER - timedelta(minutes=1)
        fields.setdefault("last_progress_at", long_ago)
        return create_test_job(
            started_by=self.user,
            job_type=J.JOB_IMPORT_UPLOADS,
            sealed=True,
            progress_target=5,
            progress_current=3,
            last_file_at=long_ago,
            result={"stages": {"media": 3}},
            **fields,
        )

    def test_a_lost_job_finishes_with_the_missing_files_failed(self):
        job = self._lost_job()

        sweep_upload_imports()

        job = _job(job)
        self.assertTrue(job.finished)
        self.assertEqual(2, job.result["lost"])
        self.assertEqual(2, job.result["error_count"])
        self.assertEqual({"media": 3}, job.result["stages"])
        # A lost task still yields the follow-ups.
        self.followups.assert_called_once_with(self.user)

    def test_a_lost_job_with_no_progress_at_all_finishes(self):
        job = self._lost_job(last_progress_at=None)

        sweep_upload_imports()

        self.assertTrue(_job(job).finished)

    def test_waits_while_the_queue_holds_tasks(self):
        job = self._lost_job()
        self.waiting.return_value = True

        sweep_upload_imports()

        self.assertFalse(_job(job).finished)
        self.followups.assert_not_called()

    def test_a_job_with_recent_progress_is_not_lost(self):
        job = self._lost_job(last_progress_at=timezone.now())

        sweep_upload_imports()

        self.assertFalse(_job(job).finished)

    def test_an_unsealed_job_is_never_lost(self):
        job = self._lost_job()
        J.objects.filter(pk=job.pk).update(sealed=False, last_file_at=timezone.now())

        sweep_upload_imports()

        self.assertFalse(_job(job).finished)

    def test_a_job_finished_meanwhile_is_left_alone(self):
        job = self._lost_job()
        J.objects.filter(pk=job.pk).update(finished=True)

        upload_import._finish_lost(job.job_id, self.user.pk)

        self.assertNotIn("lost", _job(job).result)
        self.followups.assert_not_called()

    def test_the_cleanup_service_schedules_the_sweeper_once(self):
        call_command("start_job_cleanup_service")
        call_command("start_job_cleanup_service")

        schedule = Schedule.objects.get(func=SWEEP_FUNC)
        self.assertEqual(Schedule.MINUTES, schedule.schedule_type)
        self.assertEqual(1, schedule.minutes)


class TasksAreWaitingTest(TransactionTestCase):
    def test_counts_only_tasks_no_worker_took(self):
        broker = get_broker()
        self.assertFalse(tasks_are_waiting())

        broker.enqueue("payload")
        self.assertTrue(tasks_are_waiting())

        # A taken task is locked while its cluster holds it, and comes back
        # only once that cluster is gone and the lease has run out.
        broker.dequeue()
        self.assertFalse(tasks_are_waiting())


class ImportUploadedPhotoTest(TestCase):
    def setUp(self):
        self.user = create_test_user()
        self.photo = create_test_photo(owner=self.user)
        self.job = attach_upload(self.user)
        self.steps = {}
        patched = []
        for stage, step in UPLOAD_STEPS:
            mocked = mock.Mock(name=stage)
            self.steps[stage] = mocked
            patched.append((stage, mocked))
        patcher = mock.patch.object(upload_import, "UPLOAD_STEPS", tuple(patched))
        patcher.start()
        self.addCleanup(patcher.stop)

    def run_import(self, **kwargs):
        import_uploaded_photo(
            str(self.photo.pk), "/up/web/IMG_1.jpg", self.job.job_id, **kwargs
        )
        return _job(self.job)

    def test_runs_every_step_and_counts_the_photo_once(self):
        job = self.run_import(album_id=7)

        self.assertEqual(1, job.progress_current)
        self.assertIsNotNone(job.last_progress_at)
        self.assertEqual({stage: 1 for stage, _ in UPLOAD_STEPS}, job.result["stages"])
        upload = self.steps["media"].call_args.args[0]
        self.assertEqual(self.photo.pk, upload.photo.pk)
        self.assertEqual("/up/web/IMG_1.jpg", upload.path)
        self.assertEqual(7, upload.album_id)

    def test_a_failing_step_names_the_file_and_the_rest_still_run(self):
        self.steps["tags"].side_effect = RuntimeError("tagger down")
        self.steps["faces"].side_effect = RuntimeError("faces down")

        job = self.run_import()

        self.steps["places"].assert_called_once()
        self.assertEqual(1, job.progress_current)
        self.assertNotIn("tags", job.result["stages"])
        self.assertEqual(1, job.result["stages"]["places"])
        self.assertEqual(
            [
                {
                    "photo_id": str(self.photo.pk),
                    "file": "IMG_1.jpg",
                    "stage": "tags",
                    "error": "tagger down",
                }
            ],
            job.result["failed_files"],
        )
        self.assertEqual(1, job.result["error_count"])
        self.assertEqual(["IMG_1.jpg: tags: tagger down"], job.result["errors"])

    def test_keeps_the_newest_failed_files(self):
        J.objects.filter(pk=self.job.pk).update(
            result={"failed_files": [{"photo_id": str(n)} for n in range(100)]}
        )
        self.steps["media"].side_effect = RuntimeError("broken")

        job = self.run_import()

        self.assertEqual(FAILED_FILES_KEPT, len(job.result["failed_files"]))
        self.assertEqual("1", job.result["failed_files"][0]["photo_id"])
        self.assertEqual("media", job.result["failed_files"][-1]["stage"])

    def test_a_photo_deleted_before_the_task_ran_still_counts(self):
        Photo.objects.filter(pk=self.photo.pk).delete()

        job = self.run_import()

        self.assertEqual(1, job.progress_current)
        self.steps["media"].assert_not_called()
        self.assertNotIn("failed_files", job.result)


class UploadStepsTest(TestCase):
    """The steps call the per-photo work the upload chain called."""

    def setUp(self):
        self.user = create_test_user()
        self.photo = create_test_photo(owner=self.user)
        self.upload = upload_import.UploadedPhoto(
            self.photo, "/up/a.jpg", "job-1", device_time=None, album_id=None
        )

    def test_media(self):
        with mock.patch.object(upload_import, "process_uploaded_photo") as work:
            upload_import._media(self.upload)
        work.assert_called_once_with(self.photo, "/up/a.jpg", "job-1")

    def test_album_only_with_an_album(self):
        with mock.patch.object(upload_import, "add_photo_to_user_album") as work:
            upload_import._album(self.upload)
            work.assert_not_called()
            self.upload.album_id = 3
            upload_import._album(self.upload)
        work.assert_called_once_with(self.photo, 3)

    def test_date(self):
        with mock.patch.object(
            upload_import, "apply_device_timestamp_fallback"
        ) as work:
            upload_import._date(self.upload)
        work.assert_called_once_with(self.photo, None)

    def test_tags(self):
        with mock.patch.object(upload_import.semantic, "generate_photo_tags") as work:
            upload_import._tags(self.upload)
        self.assertEqual(self.photo.pk, work.call_args.args[0].photo_id)

    def test_places(self):
        with (
            mock.patch.object(upload_import, "geolocate_photo") as geolocate,
            mock.patch.object(upload_import, "add_location_to_album_dates") as dates,
        ):
            upload_import._places(self.upload)
        geolocate.assert_called_once_with(self.photo)
        dates.assert_called_once_with(self.photo)

    def test_faces(self):
        with mock.patch.object(upload_import, "extract_faces") as work:
            upload_import._faces(self.upload)
        work.assert_called_once_with(self.photo)


class ImportJobsApiTest(TestCase):
    def setUp(self):
        self.user = create_test_user()
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)

    def test_rqavailable_ignores_an_open_import(self):
        _open_import(self.user)

        response = self.client.get("/api/rqavailable/")

        self.assertTrue(response.data["queue_can_accept_job"])
        self.assertIsNone(response.data["job_detail"])

    def test_an_unfinished_import_cannot_be_deleted(self):
        job = _open_import(self.user)

        response = self.client.delete(f"/api/jobs/{job.pk}/")

        self.assertEqual(409, response.status_code, response.content)
        self.assertEqual("upload_import_running", response.data["errors"][0]["code"])
        self.assertTrue(J.objects.filter(pk=job.pk).exists())

    def test_an_unfinished_import_cannot_be_cancelled(self):
        job = _open_import(self.user)

        response = self.client.post(f"/api/jobs/{job.pk}/cancel/")

        self.assertEqual(409, response.status_code, response.content)
        self.assertFalse(_job(job).cancelled)

    def test_a_finished_import_can_be_deleted(self):
        job = _open_import(self.user, finished=True)

        response = self.client.delete(f"/api/jobs/{job.pk}/")

        self.assertEqual(204, response.status_code, response.content)

    def test_the_job_list_names_the_type(self):
        _open_import(self.user)

        response = self.client.get("/api/jobs/")

        self.assertEqual("Import Uploads", response.data["results"][0]["job_type_str"])


class DeletingAUserSealsTheirImportTest(TestCase):
    def test_two_deleted_users_open_jobs_do_not_collide(self):
        first, second = create_test_user(), create_test_user()
        _open_import(first, progress_current=1)
        _open_import(second)

        with mock.patch(FOLLOWUPS):
            first.delete()
            second.delete()

        jobs = J.objects.filter(job_type=J.JOB_IMPORT_UPLOADS)
        self.assertEqual([True, True], [job.sealed for job in jobs])
        self.assertEqual({"deleted"}, {job.started_by.username for job in jobs})
