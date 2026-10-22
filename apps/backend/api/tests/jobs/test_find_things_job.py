"""Find things again (#2765): the Things job over every photo, and its endpoint.

``generate_tags`` covers the photos without OpenCLIP tags; with ``full_scan``
every photo with a big thumbnail, and each per-photo task replaces the tags
it finds (``force``). ``POST /api/find-things/`` starts it for the requester.
"""

import uuid
from unittest.mock import patch

from constance.test import override_config
from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from api.directory_watcher import processing_jobs
from api.directory_watcher.processing_jobs import (
    generate_tag_job,
    generate_tags,
    photos_to_tag,
)
from api.jobs.queue import Task
from api.models import LongRunningJob
from api.runtime.ml_models import download_models
from api.search.semantic import OPENCLIP
from api.tests.utils import (
    api_error,
    create_test_job,
    create_test_photo,
    create_test_user,
)


class PhotosToTagTest(TestCase):
    def setUp(self):
        self.user = create_test_user()
        self.untagged = create_test_photo(owner=self.user)
        self.tagged = create_test_photo(
            owner=self.user, captions_json={OPENCLIP: {"tags": ["beach"]}}
        )
        self.no_thumbnail = create_test_photo(owner=self.user, thumbnail_big="")
        create_test_photo(owner=create_test_user())

    def test_without_full_scan_only_the_untagged_photos(self):
        self.assertEqual(
            set(photos_to_tag(self.user, False)), {self.untagged, self.no_thumbnail}
        )

    def test_full_scan_covers_tagged_photos_with_a_big_thumbnail(self):
        self.assertEqual(
            set(photos_to_tag(self.user, True)), {self.untagged, self.tagged}
        )


class GenerateTagsFullScanTest(TestCase):
    def setUp(self):
        self.user = create_test_user()
        self.job_id = uuid.uuid4()
        self.untagged = create_test_photo(owner=self.user)
        self.tagged = create_test_photo(
            owner=self.user, captions_json={OPENCLIP: {"tags": ["beach"]}}
        )

    def _queued(self, **kwargs):
        with patch.object(processing_jobs, "enqueue_task") as enqueue:
            generate_tags(self.user, self.job_id, **kwargs)
        return {call.args[1]: call.kwargs["force"] for call in enqueue.call_args_list}

    def test_full_scan_queues_every_photo_with_force(self):
        self.assertEqual(
            self._queued(full_scan=True),
            {self.untagged.pk: True, self.tagged.pk: True},
        )
        self.assertEqual(
            LongRunningJob.objects.get(job_id=str(self.job_id)).progress_target, 2
        )

    def test_by_default_only_untagged_photos_without_force(self):
        self.assertEqual(self._queued(), {self.untagged.pk: False})


class GenerateTagJobForceTest(TestCase):
    def test_the_task_passes_force_on(self):
        user = create_test_user()
        photo = create_test_photo(owner=user)
        job = create_test_job(user, LongRunningJob.JOB_GENERATE_TAGS)

        with (
            patch.object(processing_jobs.semantic, "generate_photo_tags") as tag,
            patch.object(processing_jobs, "update_scan_counter") as counter,
        ):
            generate_tag_job(photo.pk, job.job_id, force=True)

        self.assertTrue(tag.call_args.kwargs["force"])
        counter.assert_called_once_with(job.job_id, False, None)


@patch("api.views.scan_triggers.missing_models_prerequisites", return_value=[])
class FindThingsViewTest(TestCase):
    URL = "/api/find-things/"

    def setUp(self):
        self.user = create_test_user()
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)

    def _post(self, body=None):
        with (
            patch("api.jobs.queue.AsyncTask") as async_task,
            patch("api.jobs.queue.Chain") as chain,
            self.captureOnCommitCallbacks(execute=True),
        ):
            response = self.client.post(self.URL, body or {}, format="json")
        return response, async_task, chain

    def test_starts_the_job_on_the_requesters_photos(self, _prerequisites):
        response, async_task, _ = self._post()

        self.assertEqual(response.status_code, 200)
        job = LongRunningJob.objects.get(job_id=response.json()["job_id"])
        self.assertEqual(job.job_type, LongRunningJob.JOB_GENERATE_TAGS)
        self.assertEqual(job.started_by, self.user)
        self.assertEqual(async_task.call_args.args, (generate_tags, self.user))
        self.assertEqual(async_task.call_args.kwargs["full_scan"], False)

    def test_full_scan_is_passed_on(self, _prerequisites):
        _, async_task, _ = self._post({"full_scan": True})

        self.assertEqual(async_task.call_args.kwargs["full_scan"], True)

    def test_missing_models_are_downloaded_first(self, prerequisites):
        prerequisites.side_effect = lambda user: [Task(download_models, (user,))]

        response, async_task, chain = self._post()

        self.assertEqual(response.status_code, 200)
        async_task.assert_not_called()
        appended = [call.args[0] for call in chain.return_value.append.call_args_list]
        self.assertEqual(appended, [download_models, generate_tags])

    @override_config(SCENE_CLASSIFICATION_ENABLED=False)
    def test_refused_while_the_site_switch_is_off(self, _prerequisites):
        response, async_task, _ = self._post()

        self.assertEqual(response.status_code, 403)
        async_task.assert_not_called()
        self.assertFalse(LongRunningJob.objects.exists())

    @override_settings(FEATURE_SCENE_CLASSIFICATION=False)
    def test_refused_while_the_environment_turns_it_off(self, _prerequisites):
        response, _, _ = self._post()

        self.assertEqual(response.status_code, 403)

    def test_a_malformed_full_scan_is_a_400(self, _prerequisites):
        response, _, _ = self._post({"full_scan": "maybe"})

        self.assertEqual(response.status_code, 400)
        self.assertEqual(api_error(response)["field"], "full_scan")

    def test_a_second_start_while_one_runs_is_a_409(self, _prerequisites):
        running = create_test_job(self.user, LongRunningJob.JOB_GENERATE_TAGS)

        response, _, _ = self._post()

        self.assertEqual(response.status_code, 409)
        self.assertEqual(api_error(response)["code"], "job_already_running")
        self.assertEqual(response.json()["errors"][0].get("job_id"), running.job_id)

    def test_anonymous_callers_are_refused(self, _prerequisites):
        response = APIClient().post(self.URL, {}, format="json")

        self.assertEqual(response.status_code, 401)


class SiteSettingsThingsAvailableTest(TestCase):
    """Every user learns whether the Library page can offer Find things."""

    def _available(self):
        client = APIClient()
        client.force_authenticate(user=create_test_user())
        return client.get("/api/sitesettings").json()["things_available"]

    def test_on_by_default(self):
        self.assertTrue(self._available())

    @override_config(SCENE_CLASSIFICATION_ENABLED=False)
    def test_off_with_the_site_switch(self):
        self.assertFalse(self._available())

    @override_settings(FEATURE_SCENE_CLASSIFICATION=False)
    def test_off_with_the_environment_flag(self):
        self.assertFalse(self._available())
