"""The library caption job (#2211).

Generated captions are searchable, but the only way to get one was the
caption button in the photo's details. ``generate_captions`` captions the
user's photos that have none (or, with ``full_scan``, all of them) with one
queued task per photo, like the OCR job, and ``POST /api/generate-captions/``
starts it.
"""

from unittest.mock import patch

from constance.test import override_config
from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from api.classification.captioning import CaptionError, caption_photo
from api.directory_watcher import processing_jobs
from api.directory_watcher.processing_jobs import (
    generate_caption_job,
    generate_captions,
    photos_to_caption,
)
from api.jobs.queue import Task
from api.models import LongRunningJob
from api.models.photo_caption import PhotoCaption
from api.runtime.ml_models import download_models
from api.tests.utils import (
    api_error,
    create_test_job,
    create_test_photo,
    create_test_user,
)

GENERATE_CAPTION = "api.classification.captioning.generate_caption"
MODEL_EXISTS = "api.directory_watcher.processing_jobs.captioning_model_exists"


def _running_job(user, target=1):
    job = LongRunningJob.create_job(
        user=user, job_type=LongRunningJob.JOB_GENERATE_CAPTIONS, start_now=True
    )
    job.update_progress(current=0, target=target)
    return job


class PhotosToCaptionTest(TestCase):
    def setUp(self):
        self.user = create_test_user()

    def test_photos_without_a_generated_caption_are_selected(self):
        bare = create_test_photo(owner=self.user)
        tags_only = create_test_photo(
            owner=self.user, captions_json={"openclip_vitb32": ["cat"]}
        )
        written = create_test_photo(
            owner=self.user, captions_json={"user_caption": "Grace at the lake"}
        )
        create_test_photo(owner=self.user, captions_json={"im2txt": "a cat"})

        self.assertCountEqual(
            photos_to_caption(self.user, full_scan=False),
            [bare, tags_only, written],
        )

    def test_a_full_scan_takes_the_captioned_photos_too(self):
        captioned = create_test_photo(owner=self.user, captions_json={"im2txt": "x"})
        bare = create_test_photo(owner=self.user)

        self.assertCountEqual(
            photos_to_caption(self.user, full_scan=True), [captioned, bare]
        )

    def test_videos_trashed_photos_and_photos_without_thumbnail_are_skipped(self):
        create_test_photo(owner=self.user, video=True)
        create_test_photo(owner=self.user, in_trashcan=True)
        create_test_photo(owner=self.user, removed=True)
        create_test_photo(owner=self.user, thumbnail_big="")

        for full_scan in (False, True):
            with self.subTest(full_scan=full_scan):
                self.assertFalse(photos_to_caption(self.user, full_scan).exists())

    def test_other_users_photos_are_never_selected(self):
        mine = create_test_photo(owner=self.user)
        create_test_photo(owner=create_test_user())

        for full_scan in (False, True):
            with self.subTest(full_scan=full_scan):
                self.assertEqual(list(photos_to_caption(self.user, full_scan)), [mine])


@patch(MODEL_EXISTS, return_value=True)
class GenerateCaptionsTest(TestCase):
    def setUp(self):
        self.user = create_test_user()

    def _run(self, full_scan=False):
        job = create_test_job(self.user, LongRunningJob.JOB_GENERATE_CAPTIONS)
        with patch.object(processing_jobs, "enqueue_task") as enqueue:
            generate_captions(self.user, job.job_id, full_scan=full_scan)
        job.refresh_from_db()
        return job, enqueue

    def test_queues_one_task_per_photo_by_id(self, _exists):
        photo = create_test_photo(owner=self.user)
        create_test_photo(owner=self.user, captions_json={"im2txt": "a cat"})

        job, enqueue = self._run()

        enqueue.assert_called_once_with(generate_caption_job, photo.pk, job.job_id)
        self.assertEqual(job.progress_target, 1)
        self.assertFalse(job.finished)

    def test_full_scan_queues_the_captioned_photos_too(self, _exists):
        create_test_photo(owner=self.user)
        create_test_photo(owner=self.user, captions_json={"im2txt": "a cat"})

        job, enqueue = self._run(full_scan=True)

        self.assertEqual(enqueue.call_count, 2)
        self.assertEqual(job.progress_target, 2)

    def test_nothing_to_caption_completes_the_job(self, _exists):
        job, enqueue = self._run()

        enqueue.assert_not_called()
        self.assertTrue(job.finished)
        self.assertFalse(job.failed)

    @override_config(CAPTIONING_MODEL="None")
    def test_captioning_turned_off_while_queued_completes_without_work(self, _exists):
        create_test_photo(owner=self.user)

        job, enqueue = self._run()

        enqueue.assert_not_called()
        self.assertTrue(job.finished)
        self.assertFalse(job.failed)
        self.assertEqual(job.progress_target, 0)

    def test_a_missing_model_fails_the_job(self, exists):
        exists.return_value = False
        create_test_photo(owner=self.user)

        job, enqueue = self._run()

        enqueue.assert_not_called()
        self.assertTrue(job.failed)
        self.assertIn("captioning model", job.result["error"])

    def test_cancelling_stops_queueing(self, _exists):
        for _ in range(3):
            create_test_photo(owner=self.user)
        job = create_test_job(self.user, LongRunningJob.JOB_GENERATE_CAPTIONS)

        def cancel_after_first(*args):
            LongRunningJob.objects.get(pk=job.pk).cancel()

        with (
            patch.object(processing_jobs, "CANCELLATION_CHECK_INTERVAL", 1),
            patch.object(
                processing_jobs, "enqueue_task", side_effect=cancel_after_first
            ) as enqueue,
        ):
            generate_captions(self.user, job.job_id)

        self.assertEqual(enqueue.call_count, 1)

    def test_an_error_fails_the_job(self, _exists):
        create_test_photo(owner=self.user)
        with patch.object(
            processing_jobs, "photos_to_caption", side_effect=RuntimeError("boom")
        ):
            job, _ = self._run()

        self.assertTrue(job.failed)


class GenerateCaptionJobTest(TestCase):
    def setUp(self):
        self.user = create_test_user()

    def test_stores_the_caption_and_keeps_the_users_own(self):
        photo = create_test_photo(
            owner=self.user, captions_json={"user_caption": "Grace at the lake"}
        )
        job = _running_job(self.user)

        with patch(GENERATE_CAPTION, return_value="<start> A woman by a lake <end>"):
            generate_caption_job(photo.pk, job.job_id)

        captions = PhotoCaption.objects.get(photo=photo).captions_json
        self.assertEqual(captions["im2txt"], "A woman by a lake")
        self.assertEqual(captions["user_caption"], "Grace at the lake")
        job.refresh_from_db()
        self.assertTrue(job.finished)
        self.assertFalse(job.failed)

    def test_a_photo_without_a_caption_row_gets_one(self):
        photo = create_test_photo(owner=self.user)
        job = _running_job(self.user)

        with patch(GENERATE_CAPTION, return_value="A cat"):
            generate_caption_job(photo.pk, job.job_id)

        self.assertEqual(
            PhotoCaption.objects.get(photo=photo).captions_json["im2txt"], "A cat"
        )

    def test_a_failed_photo_is_counted_with_its_error(self):
        photo = create_test_photo(owner=self.user)
        job = _running_job(self.user)

        with patch(GENERATE_CAPTION, side_effect=CaptionError("no caption in reply")):
            generate_caption_job(photo.pk, job.job_id)

        job.refresh_from_db()
        self.assertEqual(job.progress_current, 1)
        self.assertTrue(job.finished)
        self.assertEqual(job.result["error_count"], 1)
        self.assertIn(photo.image_hash, job.result["error"])
        self.assertIn("no caption in reply", job.result["error"])

    def test_a_task_of_a_cancelled_job_does_nothing(self):
        photo = create_test_photo(owner=self.user)
        job = _running_job(self.user, target=5)
        job.cancel()

        with patch(GENERATE_CAPTION) as generate:
            generate_caption_job(photo.pk, job.job_id)

        generate.assert_not_called()
        job.refresh_from_db()
        self.assertEqual(job.progress_current, 0)

    @override_config(IMAGE_CAPTIONING_ENABLED=False)
    def test_captioning_turned_off_while_running_skips_the_photo(self):
        photo = create_test_photo(owner=self.user)
        job = _running_job(self.user)

        with patch(GENERATE_CAPTION) as generate:
            generate_caption_job(photo.pk, job.job_id)

        generate.assert_not_called()
        job.refresh_from_db()
        self.assertTrue(job.finished)
        self.assertFalse(job.failed)


class CaptionPhotoTest(TestCase):
    def test_a_photo_without_thumbnail_raises(self):
        photo = create_test_photo(owner=create_test_user(), thumbnail_big="")
        caption = PhotoCaption.objects.get_or_create(photo=photo)[0]

        with (
            patch(GENERATE_CAPTION) as generate,
            self.assertRaises(CaptionError),
        ):
            caption_photo(caption)
        generate.assert_not_called()


@patch("api.views.scan_triggers.captioning_model_prerequisites", return_value=[])
class GenerateCaptionsViewTest(TestCase):
    URL = "/api/generate-captions/"

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
        data = response.json()
        self.assertFalse(data["downloads_model"])
        job = LongRunningJob.objects.get(job_id=data["job_id"])
        self.assertEqual(job.job_type, LongRunningJob.JOB_GENERATE_CAPTIONS)
        self.assertEqual(job.started_by, self.user)
        self.assertEqual(async_task.call_args.args, (generate_captions, self.user))
        self.assertEqual(async_task.call_args.kwargs["full_scan"], False)

    def test_full_scan_is_passed_on(self, _prerequisites):
        _, async_task, _ = self._post({"full_scan": True})

        self.assertEqual(async_task.call_args.kwargs["full_scan"], True)

    def test_a_missing_model_is_downloaded_first(self, prerequisites):
        prerequisites.side_effect = lambda user: [Task(download_models, (user,))]

        response, async_task, chain = self._post()

        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.json()["downloads_model"])
        async_task.assert_not_called()
        appended = [call.args[0] for call in chain.return_value.append.call_args_list]
        self.assertEqual(appended, [download_models, generate_captions])

    @override_config(IMAGE_CAPTIONING_ENABLED=False)
    def test_refused_while_the_site_switch_is_off(self, _prerequisites):
        response, async_task, _ = self._post()

        self.assertEqual(response.status_code, 403)
        async_task.assert_not_called()
        self.assertFalse(LongRunningJob.objects.exists())

    @override_settings(FEATURE_IMAGE_CAPTIONING=False)
    def test_refused_while_the_environment_turns_it_off(self, _prerequisites):
        response, _, _ = self._post()

        self.assertEqual(response.status_code, 403)

    @override_config(CAPTIONING_MODEL="None")
    def test_refused_while_the_model_is_none(self, _prerequisites):
        response, _, _ = self._post()

        self.assertEqual(response.status_code, 403)
        self.assertFalse(LongRunningJob.objects.exists())

    def test_a_malformed_full_scan_is_a_400(self, _prerequisites):
        response, _, _ = self._post({"full_scan": "maybe"})

        self.assertEqual(response.status_code, 400)
        self.assertEqual(api_error(response)["field"], "full_scan")

    def test_a_second_start_while_one_runs_is_a_409(self, _prerequisites):
        running = create_test_job(self.user, LongRunningJob.JOB_GENERATE_CAPTIONS)

        response, _, _ = self._post()

        self.assertEqual(response.status_code, 409)
        self.assertEqual(api_error(response)["code"], "job_already_running")
        self.assertEqual(response.json()["errors"][0].get("job_id"), running.job_id)

    def test_anonymous_callers_are_refused(self, _prerequisites):
        response = APIClient().post(self.URL, {}, format="json")

        self.assertEqual(response.status_code, 401)


class SiteSettingsCaptioningAvailableTest(TestCase):
    """Every user learns whether the Library page can offer the caption job."""

    def _available(self):
        client = APIClient()
        client.force_authenticate(user=create_test_user())
        return client.get("/api/sitesettings").json()["captioning_available"]

    def test_on_by_default(self):
        self.assertTrue(self._available())

    @override_config(IMAGE_CAPTIONING_ENABLED=False)
    def test_off_with_the_site_switch(self):
        self.assertFalse(self._available())

    @override_settings(FEATURE_IMAGE_CAPTIONING=False)
    def test_off_with_the_environment_flag(self):
        self.assertFalse(self._available())

    @override_config(CAPTIONING_MODEL="None")
    def test_off_with_the_model_none(self):
        self.assertFalse(self._available())
