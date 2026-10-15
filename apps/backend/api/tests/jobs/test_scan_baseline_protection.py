"""The scan baseline cannot be removed from the job list (#1104).

The next incremental scan only rereads files changed since the user's newest
complete library scan (``LongRunningJob.baseline_for``). Removing that row
made the next scan read the whole library again, so the API refuses it with a
409 ``scan_baseline`` and marks the row ``is_scan_baseline`` for the clients.
"""

import datetime
from typing import Any

from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from api.models import LongRunningJob, User
from api.tests.utils import create_test_job, create_test_user

JOBS_URL = "/api/jobs/"


def finished_job(
    user: User,
    hours_ago: float,
    job_type: int = LongRunningJob.JOB_SCAN_PHOTOS,
    **kwargs: Any,
) -> LongRunningJob:
    """A run of ``job_type`` that finished ``hours_ago`` hours ago."""
    finished_at = timezone.now() - datetime.timedelta(hours=hours_ago)
    kwargs.setdefault("result", {LongRunningJob.LIBRARY_SCAN: True})
    return create_test_job(
        started_by=user,
        job_type=job_type,
        started_at=finished_at - datetime.timedelta(minutes=5),
        finished_at=finished_at,
        finished=True,
        progress_current=10,
        progress_target=10,
        **kwargs,
    )


class ScanBaselineFlagTest(TestCase):
    """``with_scan_baseline_flag`` marks exactly the row ``baseline_for`` returns."""

    def setUp(self) -> None:
        self.alice = create_test_user()
        self.bob = create_test_user()
        self.alice_old = finished_job(self.alice, hours_ago=48)
        self.alice_baseline = finished_job(self.alice, hours_ago=24)
        # Newer, but none of them is a baseline (#2192, #2212).
        finished_job(self.alice, hours_ago=2, result={})  # a file-list scan
        finished_job(self.alice, hours_ago=1, cancelled=True)
        finished_job(self.alice, hours_ago=1, job_type=LongRunningJob.JOB_SCAN_FACES)
        create_test_job(started_by=self.alice, started_at=timezone.now())  # running
        self.bob_baseline = finished_job(self.bob, hours_ago=30)

    def flags(self) -> dict[int, bool]:
        return dict(
            LongRunningJob.objects.with_scan_baseline_flag().values_list(
                "pk", "is_scan_baseline"
            )
        )

    def test_the_flag_is_the_baseline_of_each_rows_starter(self) -> None:
        baselines = {
            user.pk: LongRunningJob.baseline_for(user, LongRunningJob.JOB_SCAN_PHOTOS)
            for user in (self.alice, self.bob)
        }
        expected = {
            job.pk: job == baselines[job.started_by_id]
            for job in LongRunningJob.objects.all()
        }

        self.assertEqual(self.flags(), expected)
        self.assertEqual(
            {pk for pk, flag in self.flags().items() if flag},
            {self.alice_baseline.pk, self.bob_baseline.pk},
        )

    def test_a_newer_library_scan_takes_the_flag_over(self) -> None:
        newer = finished_job(self.alice, hours_ago=0.5)

        flags = self.flags()

        self.assertTrue(flags[newer.pk])
        self.assertFalse(flags[self.alice_baseline.pk])


class ScanBaselineApiTest(TestCase):
    def setUp(self) -> None:
        self.user = create_test_user()
        self.other = create_test_user()
        self.admin = create_test_user(is_admin=True)
        self.old_scan = finished_job(self.user, hours_ago=48)
        self.baseline = finished_job(self.user, hours_ago=24)
        self.tags = finished_job(
            self.user, hours_ago=1, job_type=LongRunningJob.JOB_GENERATE_TAGS
        )
        self.other_baseline = finished_job(self.other, hours_ago=24)
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)

    def delete(self, job: LongRunningJob) -> Any:
        return self.client.delete(f"{JOBS_URL}{job.pk}/")

    def assert_refused(self, job: LongRunningJob) -> None:
        response = self.delete(job)

        self.assertEqual(response.status_code, 409, response.content)
        self.assertEqual(response.json()["errors"][0]["code"], "scan_baseline")
        self.assertTrue(LongRunningJob.objects.filter(pk=job.pk).exists())

    def test_the_list_marks_the_baseline(self) -> None:
        response = self.client.get(JOBS_URL)

        self.assertEqual(response.status_code, 200)
        flags = {
            row["id"]: row["is_scan_baseline"] for row in response.json()["results"]
        }
        self.assertEqual(
            flags,
            {self.old_scan.pk: False, self.baseline.pk: True, self.tags.pk: False},
        )

    def test_the_detail_marks_the_baseline(self) -> None:
        response = self.client.get(f"{JOBS_URL}{self.baseline.pk}/")

        self.assertIs(response.json()["is_scan_baseline"], True)

    def test_removing_the_baseline_is_refused(self) -> None:
        self.assert_refused(self.baseline)

    def test_an_older_scan_and_other_jobs_can_be_removed(self) -> None:
        for job in (self.old_scan, self.tags):
            with self.subTest(job=job.get_job_type_display()):
                self.assertEqual(self.delete(job).status_code, 204)
                self.assertFalse(LongRunningJob.objects.filter(pk=job.pk).exists())

    def test_the_old_baseline_can_go_once_a_newer_library_scan_finished(self) -> None:
        finished_job(self.user, hours_ago=0.5)

        self.assertEqual(self.delete(self.baseline).status_code, 204)

    def test_another_users_baseline_stays_out_of_reach(self) -> None:
        # Out of the requester's scope: a 404, as for any job of another user.
        self.assertEqual(self.delete(self.other_baseline).status_code, 404)
        self.assertTrue(
            LongRunningJob.objects.filter(pk=self.other_baseline.pk).exists()
        )

    def test_staff_cannot_remove_another_users_baseline_either(self) -> None:
        self.client.force_authenticate(user=self.admin)

        self.assert_refused(self.other_baseline)
        self.assertEqual(self.delete(self.old_scan).status_code, 204)

    def test_a_cancelled_and_a_running_job_report_no_baseline(self) -> None:
        running = create_test_job(started_by=self.user, started_at=timezone.now())

        cancelled = self.client.post(f"{JOBS_URL}{running.pk}/cancel/")
        available = self.client.get("/api/rqavailable/")

        self.assertIs(cancelled.json()["job"]["is_scan_baseline"], False)
        self.assertIsNone(available.json()["job_detail"])

    def test_the_running_job_reports_no_baseline(self) -> None:
        create_test_job(started_by=self.user, started_at=timezone.now())

        detail = self.client.get("/api/rqavailable/").json()["job_detail"]

        self.assertIs(detail["is_scan_baseline"], False)
