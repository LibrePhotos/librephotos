"""The Admin page's Finish the upgrade card (#2322): ``api.jobs.upgrade_tasks``.

After an upgrade, follow-up work was only described in the release notes, and
on Windows it needed a terminal. Each task now knows when this instance needs
it, the automatic ones are queued at startup, and the card lists the rest.
"""

import importlib
from datetime import timedelta
from io import StringIO
from unittest import mock

from django.apps import apps as global_apps
from django.core.management import call_command
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from api.jobs import upgrade_tasks
from api.jobs.upgrade_tasks import (
    TASKS_BY_KEY,
    UPGRADE_TASKS,
    start_automatic_tasks,
    task_overview,
)
from api.models import LongRunningJob, Photo, UpgradeTaskState
from api.search.embedding_jobs import batch_calculate_clip_embedding
from api.search.semantic import OPENCLIP
from api.tests.utils import (
    api_error,
    create_test_job,
    create_test_photo,
    create_test_upgrade_task_state,
    create_test_user,
)
from api.thumbnails.metadata import strip_thumbnail_metadata_job

migration_0185 = importlib.import_module("api.migrations.0185_upgrade_task_state")

STRIP = "strip_thumbnail_metadata"
EXPOSURE = "refresh_exposure_times"
PROBE = "probe_videos"
SEARCH = "semantic_search_conversion"
LIST_URL = "/api/upgrade-tasks/"


def start_url(key: str) -> str:
    return f"/api/upgrade-tasks/{key}/start/"


def dismiss_url(key: str) -> str:
    return f"/api/upgrade-tasks/{key}/dismiss/"


def rows() -> dict[str, dict[str, object]]:
    return {row["key"]: dict(row) for row in task_overview()["tasks"]}


def finished_job(user, job_type, **kwargs):
    return create_test_job(
        user, job_type, finished=True, finished_at=timezone.now(), **kwargs
    )


class UpgradeTaskTestCase(TestCase):
    def setUp(self):
        self.admin = create_test_user(is_admin=True)
        # ffprobe is there unless a test says otherwise.
        patcher = mock.patch.object(upgrade_tasks.color, "can_probe", return_value=True)
        self.can_probe = patcher.start()
        self.addCleanup(patcher.stop)


class TheRegistryTest(TestCase):
    def test_keys_are_unique_and_automatic_tasks_are_required(self):
        self.assertEqual(len(TASKS_BY_KEY), len(UPGRADE_TASKS))
        for task in UPGRADE_TASKS:
            self.assertEqual(task.required, task.kind == "automatic", task.key)

    def test_only_tasks_without_another_starter_start_themselves(self):
        self.assertEqual(
            {task.key for task in UPGRADE_TASKS if task.autostart}, {STRIP, EXPOSURE}
        )


class SeedingMigrationTest(TestCase):
    """Fresh installs never see a task about data an older release left."""

    def seed(self):
        migration_0185.seed_upgrade_tasks(global_apps, None)
        return set(UpgradeTaskState.objects.values_list("key", flat=True))

    def test_a_fresh_database_gets_no_rows(self):
        self.assertEqual(self.seed(), set())

    def test_photos_seed_the_thumbnail_cleanup(self):
        create_test_photo(owner=create_test_user())
        self.assertEqual(self.seed(), {STRIP})

    def test_misread_shutter_speeds_seed_their_refresh(self):
        create_test_photo(owner=create_test_user(), shutter_speed="0")
        self.assertEqual(self.seed(), {STRIP, EXPOSURE})

    def test_unprobed_videos_seed_the_probe(self):
        create_test_photo(owner=create_test_user(), video=True)
        self.assertEqual(self.seed(), {STRIP, PROBE})

    def test_seeding_twice_keeps_one_row(self):
        create_test_photo(owner=create_test_user())
        self.seed()
        self.assertEqual(self.seed(), {STRIP})
        self.assertEqual(UpgradeTaskState.objects.count(), 1)


class WhenATaskIsNeededTest(UpgradeTaskTestCase):
    def test_nothing_without_rows_or_old_embeddings(self):
        create_test_photo(owner=self.admin, video=True, shutter_speed="0")
        self.assertEqual(rows(), {})
        self.assertFalse(UpgradeTaskState.objects.exists())

    def test_a_seeded_cleanup_is_needed_until_a_clean_run(self):
        state = create_test_upgrade_task_state(STRIP)
        self.assertEqual(rows()[STRIP]["status"], "pending")

        # A failed or cancelled run does not count, nor one from before the row.
        finished_job(
            self.admin,
            LongRunningJob.JOB_STRIP_THUMBNAIL_METADATA,
            queued_at=state.created_at - timedelta(days=1),
        )
        finished_job(
            self.admin, LongRunningJob.JOB_STRIP_THUMBNAIL_METADATA, cancelled=True
        )
        self.assertNotEqual(rows()[STRIP]["status"], "done")

        finished_job(self.admin, LongRunningJob.JOB_STRIP_THUMBNAIL_METADATA)
        self.assertEqual(rows()[STRIP]["status"], "done")
        state.refresh_from_db()
        self.assertIsNotNone(state.completed_at)

    def test_the_probe_is_done_when_no_video_is_left(self):
        video = create_test_photo(owner=self.admin, video=True)
        create_test_upgrade_task_state(PROBE)
        self.assertEqual(rows()[PROBE]["status"], "pending")
        self.assertEqual(rows()[PROBE]["count"], 1)

        Photo.objects.filter(pk=video.pk).update(video_color_transfer="bt709")

        self.assertEqual(rows()[PROBE]["status"], "done")
        self.assertIsNone(rows()[PROBE]["count"])
        self.assertIsNotNone(UpgradeTaskState.objects.get(key=PROBE).completed_at)

    def test_the_probe_is_not_needed_without_ffprobe(self):
        create_test_photo(owner=self.admin, video=True)
        create_test_upgrade_task_state(PROBE)
        self.can_probe.return_value = False
        self.assertEqual(rows()[PROBE]["status"], "done")

    def test_a_finished_seeded_task_does_not_come_back(self):
        create_test_photo(owner=self.admin, video=True)
        create_test_upgrade_task_state(PROBE, completed_at=timezone.now())
        self.assertEqual(rows()[PROBE]["status"], "done")

    def test_old_embeddings_make_the_search_task_appear(self):
        photo = create_test_photo(owner=self.admin)
        Photo.objects.filter(pk=photo.pk).update(clip_embeddings=[1.0])
        self.assertEqual(rows()[SEARCH]["status"], "pending")
        self.assertTrue(UpgradeTaskState.objects.filter(key=SEARCH).exists())

        Photo.objects.filter(pk=photo.pk).update(clip_embeddings_model=OPENCLIP)
        self.assertEqual(rows()[SEARCH]["status"], "done")

    def test_the_search_task_opens_again_for_a_later_model(self):
        photo = create_test_photo(owner=self.admin)
        Photo.objects.filter(pk=photo.pk).update(clip_embeddings=[1.0])
        create_test_upgrade_task_state(
            SEARCH,
            created_at=timezone.now() - timedelta(days=30),
            started_at=timezone.now() - timedelta(days=30),
            completed_at=timezone.now() - timedelta(days=29),
        )

        self.assertEqual(rows()[SEARCH]["status"], "pending")
        state = UpgradeTaskState.objects.get(key=SEARCH)
        self.assertIsNone(state.completed_at)
        self.assertIsNone(state.started_at)

    def test_a_done_task_goes_after_a_day(self):
        create_test_upgrade_task_state(
            STRIP, completed_at=timezone.now() - timedelta(days=2)
        )
        self.assertEqual(rows(), {})

    def test_a_dismissed_task_is_not_listed(self):
        create_test_photo(owner=self.admin, video=True)
        create_test_upgrade_task_state(PROBE, dismissed_at=timezone.now())
        self.assertEqual(rows(), {})


class TaskStatusTest(UpgradeTaskTestCase):
    def test_running_jobs_add_up_their_progress(self):
        create_test_photo(owner=self.admin, video=True)
        create_test_upgrade_task_state(PROBE)
        other = create_test_user()
        first = create_test_job(
            self.admin,
            LongRunningJob.JOB_PROBE_VIDEOS,
            started_at=timezone.now(),
            progress_current=3,
            progress_target=10,
        )
        create_test_job(
            other,
            LongRunningJob.JOB_PROBE_VIDEOS,
            progress_current=1,
            progress_target=5,
        )

        row = rows()[PROBE]
        self.assertEqual(row["status"], "running")
        self.assertEqual((row["progress_current"], row["progress_target"]), (4, 15))
        self.assertEqual(row["latest_job_id"], first.pk)

    def test_a_failed_run_offers_retry_with_its_error(self):
        create_test_upgrade_task_state(STRIP)
        job = finished_job(
            self.admin,
            LongRunningJob.JOB_STRIP_THUMBNAIL_METADATA,
            failed=True,
            result={"status": "failed", "error": "the disk is full"},
        )

        row = rows()[STRIP]
        self.assertEqual(row["status"], "failed")
        self.assertEqual(row["error"], "the disk is full")
        self.assertEqual(row["latest_job_id"], job.pk)

    def test_a_cancelled_run_is_failed_without_an_error(self):
        create_test_upgrade_task_state(STRIP)
        finished_job(
            self.admin,
            LongRunningJob.JOB_STRIP_THUMBNAIL_METADATA,
            cancelled=True,
            result={"status": "cancelled"},
        )
        row = rows()[STRIP]
        self.assertEqual((row["status"], row["error"]), ("failed", None))


class StartingTasksTest(UpgradeTaskTestCase):
    def test_the_cleanup_is_queued_for_the_admin(self):
        state = create_test_upgrade_task_state(STRIP)
        with (
            mock.patch("api.jobs.queue.AsyncTask") as async_task,
            self.captureOnCommitCallbacks(execute=True),
        ):
            [job] = upgrade_tasks.start_task(TASKS_BY_KEY[STRIP], self.admin)

        self.assertEqual(job.job_type, LongRunningJob.JOB_STRIP_THUMBNAIL_METADATA)
        self.assertEqual(job.started_by, self.admin)
        self.assertEqual(
            async_task.call_args.args, (strip_thumbnail_metadata_job, self.admin)
        )
        state.refresh_from_db()
        self.assertIsNotNone(state.started_at)

    def test_the_probe_is_queued_per_owner(self):
        other = create_test_user()
        create_test_photo(owner=self.admin, video=True)
        create_test_photo(owner=other, video=True)
        create_test_upgrade_task_state(PROBE)
        with mock.patch("api.jobs.queue.AsyncTask"):
            jobs = upgrade_tasks.start_task(TASKS_BY_KEY[PROBE], self.admin)

        self.assertEqual(
            [(job.job_type, job.started_by) for job in jobs],
            [
                (LongRunningJob.JOB_PROBE_VIDEOS, self.admin),
                (LongRunningJob.JOB_PROBE_VIDEOS, other),
            ],
        )

    def test_the_search_conversion_is_queued_per_owner(self):
        photo = create_test_photo(owner=self.admin)
        Photo.objects.filter(pk=photo.pk).update(clip_embeddings=[1.0])
        with (
            mock.patch("api.jobs.queue.AsyncTask") as async_task,
            self.captureOnCommitCallbacks(execute=True),
        ):
            [job] = upgrade_tasks.start_task(TASKS_BY_KEY[SEARCH], self.admin)

        self.assertEqual(job.job_type, LongRunningJob.JOB_CALCULATE_CLIP_EMBEDDINGS)
        self.assertEqual(
            async_task.call_args.args, (batch_calculate_clip_embedding, self.admin)
        )


class StartingAtStartupTest(UpgradeTaskTestCase):
    def test_automatic_tasks_are_queued_once(self):
        create_test_upgrade_task_state(STRIP)
        create_test_upgrade_task_state(EXPOSURE)
        create_test_photo(owner=self.admin, video=True)
        create_test_upgrade_task_state(PROBE)
        with mock.patch("api.jobs.queue.AsyncTask"):
            self.assertEqual(start_automatic_tasks(), [STRIP, EXPOSURE])
            # Not again on the next start, though the jobs have not run.
            self.assertEqual(start_automatic_tasks(), [])

        self.assertEqual(
            set(LongRunningJob.objects.values_list("job_type", flat=True)),
            {
                LongRunningJob.JOB_STRIP_THUMBNAIL_METADATA,
                LongRunningJob.JOB_REFRESH_EXPOSURE_TIMES,
            },
        )

    def test_a_failed_task_waits_for_retry(self):
        create_test_upgrade_task_state(STRIP, started_at=timezone.now())
        finished_job(
            self.admin, LongRunningJob.JOB_STRIP_THUMBNAIL_METADATA, failed=True
        )
        with mock.patch("api.jobs.queue.AsyncTask") as async_task:
            self.assertEqual(start_automatic_tasks(), [])
        async_task.assert_not_called()

    def test_a_task_already_running_is_not_queued_again(self):
        create_test_upgrade_task_state(STRIP)
        create_test_job(self.admin, LongRunningJob.JOB_STRIP_THUMBNAIL_METADATA)
        with mock.patch("api.jobs.queue.AsyncTask"):
            self.assertEqual(start_automatic_tasks(), [])

    def test_nothing_without_an_admin(self):
        self.admin.is_superuser = False
        self.admin.save()
        create_test_upgrade_task_state(STRIP)
        self.assertEqual(start_automatic_tasks(), [])

    def test_a_queueing_failure_is_logged_and_skipped(self):
        create_test_upgrade_task_state(STRIP)
        with (
            mock.patch.object(
                upgrade_tasks, "enqueue_for_request", side_effect=RuntimeError("down")
            ),
            self.assertLogs("api.jobs.upgrade_tasks", "ERROR"),
        ):
            self.assertEqual(start_automatic_tasks(), [])
        self.assertIsNone(UpgradeTaskState.objects.get(key=STRIP).started_at)

    def test_the_command_says_what_it_queued(self):
        create_test_upgrade_task_state(STRIP)
        out = StringIO()
        with mock.patch("api.jobs.queue.AsyncTask"):
            call_command("start_upgrade_tasks", stdout=out)
        self.assertIn(STRIP, out.getvalue())

        out = StringIO()
        call_command("start_upgrade_tasks", stdout=out)
        self.assertEqual(out.getvalue(), "")


class UpgradeTaskApiTest(UpgradeTaskTestCase):
    def setUp(self):
        super().setUp()
        self.client = APIClient()
        self.client.force_authenticate(user=self.admin)

    def test_the_list(self):
        create_test_upgrade_task_state(STRIP)
        response = self.client.get(LIST_URL)

        self.assertEqual(response.status_code, 200)
        [row] = response.json()["tasks"]
        self.assertEqual(
            row,
            {
                "key": STRIP,
                "kind": "automatic",
                "optional": False,
                "status": "pending",
                "count": None,
                "progress_current": None,
                "progress_target": None,
                "latest_job_id": None,
                "error": None,
                "completed_at": None,
            },
        )

    def test_only_admins(self):
        create_test_upgrade_task_state(STRIP)
        user = APIClient()
        user.force_authenticate(user=create_test_user())
        anonymous = APIClient()
        for client, status in ((user, 403), (anonymous, 401)):
            self.assertEqual(client.get(LIST_URL).status_code, status)
            self.assertEqual(client.post(start_url(STRIP)).status_code, status)
            self.assertEqual(client.post(dismiss_url(STRIP)).status_code, status)
        self.assertFalse(LongRunningJob.objects.exists())

    def test_start(self):
        create_test_upgrade_task_state(STRIP)
        with (
            mock.patch("api.jobs.queue.AsyncTask"),
            self.captureOnCommitCallbacks(execute=True),
        ):
            response = self.client.post(start_url(STRIP))

        self.assertEqual(response.status_code, 200)
        job = LongRunningJob.objects.get(job_id=response.json()["job_id"])
        self.assertEqual(job.job_type, LongRunningJob.JOB_STRIP_THUMBNAIL_METADATA)
        self.assertEqual(response.json()["job_ids"], [job.job_id])

    def test_start_is_refused_while_another_job_runs(self):
        create_test_upgrade_task_state(STRIP)
        create_test_job(create_test_user(), LongRunningJob.JOB_SCAN_PHOTOS)
        response = self.client.post(start_url(STRIP))

        self.assertEqual(response.status_code, 409)
        self.assertEqual(api_error(response)["code"], "queue_busy")
        self.assertEqual(LongRunningJob.objects.count(), 1)

    def test_start_while_its_own_job_runs_names_that_job(self):
        create_test_upgrade_task_state(STRIP)
        running = create_test_job(
            create_test_user(), LongRunningJob.JOB_STRIP_THUMBNAIL_METADATA
        )
        response = self.client.post(start_url(STRIP))

        self.assertEqual(response.status_code, 409)
        self.assertEqual(api_error(response)["code"], "job_already_running")
        self.assertEqual(api_error(response)["job_id"], running.job_id)

    def test_start_of_a_task_with_nothing_to_do(self):
        response = self.client.post(start_url(PROBE))
        self.assertEqual(response.status_code, 409)
        self.assertEqual(api_error(response)["code"], "task_not_needed")

    def test_unknown_task(self):
        self.assertEqual(self.client.post(start_url("nope")).status_code, 404)
        self.assertEqual(self.client.post(dismiss_url("nope")).status_code, 404)

    def test_not_now_hides_an_optional_task(self):
        create_test_photo(owner=self.admin, video=True)
        create_test_upgrade_task_state(PROBE)
        response = self.client.post(dismiss_url(PROBE))

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"tasks": []})
        self.assertIsNotNone(UpgradeTaskState.objects.get(key=PROBE).dismissed_at)

    def test_a_required_task_cannot_be_dismissed(self):
        create_test_upgrade_task_state(STRIP)
        response = self.client.post(dismiss_url(STRIP))

        self.assertEqual(response.status_code, 400)
        self.assertEqual(api_error(response)["code"], "task_required")
        self.assertIsNone(UpgradeTaskState.objects.get(key=STRIP).dismissed_at)
