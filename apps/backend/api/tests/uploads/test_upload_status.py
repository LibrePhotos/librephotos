"""``GET /api/upload/status/``: what the caller's uploads do on the server (#2739)."""

from datetime import timedelta
from urllib.parse import urlencode

from django.test import TestCase
from django.utils import timezone
from django_q.models import Schedule
from rest_framework.test import APIClient

from api.jobs.queue import next_scheduled_run
from api.jobs.upload_followups import (
    RUN_FUNC,
    followup_status,
    schedule_upload_followups,
)
from api.jobs.upload_status import MAX_IMPORTS_SHOWN
from api.models import LongRunningJob, Thumbnail, UploadFollowupState
from api.tests.utils import (
    create_test_job,
    create_test_photo,
    create_test_upload_followup_state,
    create_test_user,
)

J = LongRunningJob
URL = "/api/upload/status/"


def _import_job(user, **kwargs):
    return create_test_job(started_by=user, job_type=J.JOB_IMPORT_UPLOADS, **kwargs)


def _schedule_followups(user, at):
    schedule_upload_followups(user, at)
    return Schedule.objects.get(name=f"upload-followups-{user.id}")


class UploadStatusTest(TestCase):
    def setUp(self):
        self.user = create_test_user()
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)

    def status(self, **params):
        response = self.client.get(f"{URL}?{urlencode(params, doseq=True)}")
        self.assertEqual(200, response.status_code, response.content)
        return response.json()

    def job_ids(self, body):
        return [job["job_id"] for job in body["imports"]]

    def test_nothing_going_on(self):
        self.assertEqual(
            {
                "imports": [],
                "ready_photo_ids": [],
                "followups": {"state": "idle", "next_run_at": None},
            },
            self.status(),
        )

    def test_lists_unfinished_imports_newest_first(self):
        now = timezone.now()
        older = _import_job(
            self.user, sealed=True, queued_at=now - timedelta(minutes=5)
        )
        open_job = _import_job(self.user, sealed=False, queued_at=now)
        _import_job(self.user, finished=True)
        create_test_job(started_by=self.user)  # a scan, not an upload import

        body = self.status()

        self.assertEqual([open_job.job_id, older.job_id], self.job_ids(body))
        self.assertEqual("Import Uploads", body["imports"][0]["job_type_str"])

    def test_a_named_job_is_listed_once_it_finished(self):
        done = _import_job(
            self.user, finished=True, progress_target=3, progress_current=3
        )

        body = self.status(job_id=[done.job_id])

        self.assertEqual([done.job_id], self.job_ids(body))
        self.assertTrue(body["imports"][0]["finished"])

    def test_another_users_jobs_are_never_listed(self):
        other = create_test_user(is_staff=True)
        theirs = _import_job(other, sealed=False)
        finished = _import_job(other, finished=True)
        mine = _import_job(self.user, sealed=False)

        body = self.status(job_id=[theirs.job_id, finished.job_id])

        self.assertEqual([mine.job_id], self.job_ids(body))

    def test_staff_see_only_their_own_imports(self):
        staff = create_test_user(is_staff=True, is_superuser=True)
        _import_job(self.user, sealed=False)
        self.client.force_authenticate(user=staff)

        self.assertEqual([], self.status()["imports"])

    def test_the_list_is_capped(self):
        for _ in range(MAX_IMPORTS_SHOWN + 2):
            _import_job(self.user, sealed=True)

        self.assertEqual(MAX_IMPORTS_SHOWN, len(self.status()["imports"]))

    def test_ready_photos_have_their_thumbnails(self):
        ready = create_test_photo(owner=self.user)
        processing = create_test_photo(owner=self.user)
        Thumbnail.objects.filter(photo=processing).update(aspect_ratio=None)
        theirs = create_test_photo(owner=create_test_user())

        body = self.status(photo_id=[ready.pk, processing.pk, theirs.pk])

        self.assertEqual([str(ready.pk)], body["ready_photo_ids"])

    def test_a_malformed_photo_id_is_a_400(self):
        response = self.client.get(f"{URL}?photo_id=not-a-uuid")

        self.assertEqual(400, response.status_code)
        self.assertEqual("photo_id", response.json()["errors"][0]["field"])

    def test_too_many_ids_are_refused(self):
        ids = [f"job-{n}" for n in range(101)]
        response = self.client.get(f"{URL}?{urlencode({'job_id': ids}, doseq=True)}")

        self.assertEqual(400, response.status_code)

    def test_needs_a_login(self):
        self.assertEqual(401, APIClient().get(URL).status_code)

    def test_reports_the_followups(self):
        create_test_upload_followup_state(
            self.user, lease_expires_at=timezone.now() + timedelta(minutes=5)
        )

        self.assertEqual("running", self.status()["followups"]["state"])


class FollowupStatusTest(TestCase):
    def setUp(self):
        self.user = create_test_user()
        self.now = timezone.now()

    def test_idle_without_a_run(self):
        self.assertEqual(
            {"state": "idle", "next_run_at": None}, followup_status(self.user)
        )

    def test_reading_makes_no_state_row(self):
        followup_status(self.user)

        self.assertFalse(UploadFollowupState.objects.owned_by(self.user).exists())

    def test_running_while_a_run_holds_the_lease(self):
        create_test_upload_followup_state(
            self.user, lease_expires_at=self.now + timedelta(minutes=5)
        )

        self.assertEqual("running", followup_status(self.user)["state"])

    def test_an_expired_lease_is_no_run(self):
        create_test_upload_followup_state(
            self.user, lease_expires_at=self.now - timedelta(minutes=1)
        )

        self.assertEqual("idle", followup_status(self.user)["state"])

    def test_pending_while_a_run_is_due_soon(self):
        at = self.now + timedelta(minutes=2)
        _schedule_followups(self.user, at)

        self.assertEqual(
            {"state": "pending", "next_run_at": at}, followup_status(self.user)
        )

    def test_a_run_waiting_for_a_quiet_period_is_not_pending(self):
        at = self.now + timedelta(minutes=30)
        _schedule_followups(self.user, at)

        self.assertEqual(
            {"state": "idle", "next_run_at": at}, followup_status(self.user)
        )

    def test_a_run_nothing_picked_up_is_not_pending(self):
        _schedule_followups(self.user, self.now - timedelta(minutes=10))

        self.assertEqual("idle", followup_status(self.user)["state"])

    def test_another_users_run_does_not_count(self):
        other = create_test_user()
        _schedule_followups(other, self.now + timedelta(minutes=1))
        create_test_upload_followup_state(
            other, lease_expires_at=self.now + timedelta(minutes=5)
        )

        self.assertEqual("idle", followup_status(self.user)["state"])


class NextScheduledRunTest(TestCase):
    def test_when_the_named_schedule_runs(self):
        user = create_test_user()
        now = timezone.now()
        _schedule_followups(user, now + timedelta(minutes=3))

        self.assertEqual(
            now + timedelta(minutes=3),
            next_scheduled_run(f"upload-followups-{user.id}", RUN_FUNC),
        )

    def test_none_without_one(self):
        self.assertIsNone(next_scheduled_run("upload-followups-0", RUN_FUNC))
