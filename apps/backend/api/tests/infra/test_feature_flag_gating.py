import os
import shutil
import tempfile
import uuid
from unittest.mock import MagicMock, patch

import requests
from django.conf import settings
from django.test import SimpleTestCase, TestCase, override_settings
from rest_framework.test import APIClient

from api.classification.captioning import generate_photo_caption
from api.directory_watcher.file_handlers import group_files_into_photo
from api.directory_watcher.scan_jobs import (
    add_geolocation,
    batch_calculate_clip_embedding,
    generate_tags,
    scan_faces,
    scan_photos,
)
from api.face_classify import cluster_all_faces
from api.geocode.geocode import reverse_geocode, search_location
from api.media_files import is_valid_media
from api.models import Face, LongRunningJob
from api.models.photo_caption import PhotoCaption
from api.photo_faces import extract_faces
from api.semantic_search import generate_photo_tags
from api.tests.utils import (
    ONE_PIXEL_PNG,
    create_test_file,
    create_test_job,
    create_test_photo,
    create_test_user,
)
from librephotos.env import env_flag

FEATURE_FLAGS = (
    "FEATURE_VIDEO",
    "FEATURE_FACE_DETECTION",
    "FEATURE_FACE_CLUSTER",
    "FEATURE_IMAGE_CAPTIONING",
    "FEATURE_REVERSE_GEOCODING",
    "FEATURE_SCENE_CLASSIFICATION",
)


class EnvFlagTest(SimpleTestCase):
    def test_unset_variable_uses_the_default(self):
        with patch.dict(os.environ, {}, clear=True):
            self.assertTrue(env_flag("FEATURE_TEST", default=True))
            self.assertFalse(env_flag("FEATURE_TEST", default=False))

    def test_truthy_values(self):
        for value in ("true", "True", "TRUE", "1", "yes", "on", " On "):
            with patch.dict(os.environ, {"FEATURE_TEST": value}):
                self.assertTrue(env_flag("FEATURE_TEST", default=True), value)

    def test_falsy_values(self):
        for value in ("false", "False", "0", "no", "off", "", "nonsense"):
            with patch.dict(os.environ, {"FEATURE_TEST": value}):
                self.assertFalse(env_flag("FEATURE_TEST", default=True), value)


class FeatureFlagDefaultsTest(SimpleTestCase):
    def test_every_feature_is_on_out_of_the_box(self):
        for flag in FEATURE_FLAGS:
            self.assertTrue(getattr(settings, flag), flag)


class VideoFeatureFlagTest(TestCase):
    def setUp(self):
        self.user = create_test_user()

    def _is_valid_video(self):
        with patch("api.media_files.is_video", return_value=True):
            return is_valid_media(path="/data/clip.mp4", user=self.user)

    def test_video_is_admitted_by_default(self):
        self.assertTrue(self._is_valid_video())

    @override_settings(FEATURE_VIDEO=False)
    def test_video_is_rejected_when_disabled(self):
        self.assertFalse(self._is_valid_video())

    @override_settings(FEATURE_VIDEO=False)
    def test_images_are_still_admitted_when_video_is_disabled(self):
        with patch("api.media_files.is_video", return_value=False):
            self.assertTrue(is_valid_media(path="/data/sidecar.xmp", user=self.user))


class EmbeddedMotionVideoFeatureFlagTest(TestCase):
    """The video extracted from a live photo never passes through is_valid_media."""

    def setUp(self):
        self.user = create_test_user()
        self.directory = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.directory, ignore_errors=True)
        self.file = create_test_file(
            os.path.join(self.directory, "motion.png"), self.user, ONE_PIXEL_PNG
        )

    def _group_files_into_photo(self):
        with (
            patch(
                "api.directory_watcher.file_handlers.has_embedded_motion_video",
                return_value=True,
            ),
            patch(
                "api.directory_watcher.file_handlers.extract_embedded_motion_video",
                return_value=None,
            ) as extract_mock,
        ):
            group_files_into_photo(self.user, [self.file], job_id="test-job")
        return extract_mock

    def test_embedded_video_is_extracted_by_default(self):
        self._group_files_into_photo().assert_called_once()

    @override_settings(FEATURE_VIDEO=False)
    def test_embedded_video_is_not_extracted_when_video_is_disabled(self):
        self._group_files_into_photo().assert_not_called()


class ReverseGeocodingFeatureFlagTest(TestCase):
    @patch("api.geocode.geocode.wait_for_provider")
    @patch("api.geocode.geocode.Geocode")
    def test_reverse_geocode_runs_by_default(self, geocode_mock, wait_mock):
        geocode_mock.return_value.reverse.return_value = {"places365": []}

        self.assertEqual({"places365": []}, reverse_geocode(52.52, 13.40))
        geocode_mock.assert_called_once()

    @override_settings(FEATURE_REVERSE_GEOCODING=False)
    @patch("api.geocode.geocode.wait_for_provider")
    @patch("api.geocode.geocode.Geocode")
    def test_reverse_geocode_skipped_when_disabled(self, geocode_mock, wait_mock):
        self.assertEqual({}, reverse_geocode(52.52, 13.40))
        geocode_mock.assert_not_called()
        wait_mock.assert_not_called()

    @override_settings(FEATURE_REVERSE_GEOCODING=False)
    @patch("api.geocode.geocode.wait_for_provider")
    @patch("api.geocode.geocode.Geocode")
    def test_search_location_is_not_gated(self, geocode_mock, wait_mock):
        """The search box uses forward geocoding, which is a different feature."""
        geocode_mock.return_value.search.return_value = [{"display_name": "Berlin"}]

        self.assertEqual([{"display_name": "Berlin"}], search_location("Berlin"))
        geocode_mock.assert_called_once()


class SceneClassificationFeatureFlagTest(TestCase):
    def setUp(self):
        self.user = create_test_user()
        self.photo = create_test_photo(owner=self.user)
        self.caption = PhotoCaption.objects.create(photo=self.photo)

    @patch("api.sidecars.http.post")
    def test_tags_are_generated_by_default(self, post_mock):
        response = MagicMock(ok=False, status_code=503)
        response.raise_for_status.side_effect = requests.HTTPError(
            "503 Server Error", response=response
        )
        post_mock.return_value = response

        generate_photo_tags(self.caption)
        post_mock.assert_called_once()

    @override_settings(FEATURE_SCENE_CLASSIFICATION=False)
    @patch("api.sidecars.http.post")
    def test_tags_skipped_when_disabled(self, post_mock):
        generate_photo_tags(self.caption)
        post_mock.assert_not_called()


class ImageCaptioningFeatureFlagTest(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.user = create_test_user()
        self.client.force_authenticate(user=self.user)
        self.photo = create_test_photo(owner=self.user)
        self.caption = PhotoCaption.objects.create(photo=self.photo)

    @patch("api.classification.captioning.generate_caption", return_value="a cat")
    def test_captions_are_generated_by_default(self, generate_caption_mock):
        self.assertTrue(generate_photo_caption(self.caption))
        generate_caption_mock.assert_called_once()

    @override_settings(FEATURE_IMAGE_CAPTIONING=False)
    @patch("api.classification.captioning.generate_caption")
    def test_captions_skipped_when_disabled(self, generate_caption_mock):
        self.assertFalse(generate_photo_caption(self.caption))
        generate_caption_mock.assert_not_called()

    @override_settings(FEATURE_IMAGE_CAPTIONING=False)
    @patch("api.classification.captioning.generate_photo_caption")
    def test_generate_caption_endpoint_refuses_when_disabled(
        self, generate_captions_mock
    ):
        response = self.client.post(
            "/api/photosedit/generateim2txt/",
            format="json",
            data={"image_hash": self.photo.image_hash},
        )

        self.assertEqual(403, response.status_code)
        self.assertEqual("permission_denied", response.json()["errors"][0]["code"])
        generate_captions_mock.assert_not_called()


class FaceDetectionFeatureFlagTest(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.user = create_test_user()
        self.client.force_authenticate(user=self.user)
        self.photo = create_test_photo(owner=self.user)

    @patch("api.photo_faces.PIL.Image.open")
    @patch("api.photo_faces.face_extractor")
    def test_faces_are_extracted_by_default(self, face_extractor_mock, image_open_mock):
        face_extractor_mock.extract.return_value = []

        extract_faces(self.photo)
        face_extractor_mock.extract.assert_called_once()

    @override_settings(FEATURE_FACE_DETECTION=False)
    @patch("api.photo_faces.PIL.Image.open")
    @patch("api.photo_faces.face_extractor")
    def test_faces_are_not_extracted_when_disabled(
        self, face_extractor_mock, image_open_mock
    ):
        """The upload pipeline calls this directly, bypassing the scan gates."""
        extract_faces(self.photo)

        face_extractor_mock.extract.assert_not_called()
        self.assertEqual(0, Face.objects.filter(photo=self.photo).count())

    @patch("api.ml_models.do_all_models_exist", return_value=True)
    @patch("api.jobs.queue.AsyncTask")
    def test_scan_faces_endpoint_starts_a_job_by_default(
        self, task_mock, models_exist_mock
    ):
        with self.captureOnCommitCallbacks(execute=True):
            response = self.client.post("/api/scanfaces/", format="json")

        self.assertEqual(200, response.status_code)
        self.assertTrue(response.json()["status"])
        task_mock.return_value.run.assert_called_once()

    @override_settings(FEATURE_FACE_DETECTION=False)
    @patch("api.ml_models.do_all_models_exist", return_value=True)
    @patch("api.jobs.queue.AsyncTask")
    def test_scan_faces_endpoint_refuses_when_disabled(
        self, task_mock, models_exist_mock
    ):
        response = self.client.post("/api/scanfaces/", format="json")

        self.assertEqual(403, response.status_code)
        self.assertEqual("permission_denied", response.json()["errors"][0]["code"])
        task_mock.assert_not_called()
        self.assertEqual(0, LongRunningJob.objects.count())


class FaceClusterFeatureFlagTest(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.user = create_test_user()
        self.client.force_authenticate(user=self.user)

    @patch("api.face_classify.enqueue_followup")
    @patch("api.face_classify.create_all_clusters", return_value=0)
    def test_cluster_all_faces_runs_by_default(self, create_clusters_mock, queue_mock):
        self.assertTrue(cluster_all_faces(self.user, uuid.uuid4()))
        create_clusters_mock.assert_called_once()
        # The training follows as a job of its own.
        self.assertEqual(queue_mock.call_args.args[1], LongRunningJob.JOB_TRAIN_FACES)

    @override_settings(FEATURE_FACE_CLUSTER=False)
    @patch("api.face_classify.enqueue_followup")
    @patch("api.face_classify.create_all_clusters")
    def test_cluster_all_faces_skipped_when_disabled(
        self, create_clusters_mock, queue_mock
    ):
        self.assertFalse(cluster_all_faces(self.user, uuid.uuid4()))
        create_clusters_mock.assert_not_called()
        queue_mock.assert_not_called()
        self.assertEqual(0, LongRunningJob.objects.count())

    @override_settings(FEATURE_FACE_CLUSTER=False)
    @patch("api.face_classify.create_all_clusters")
    def test_a_queued_cluster_job_is_finished_when_disabled(self, create_clusters_mock):
        # Queued before the flag went off: the row must not stay queued.
        job = create_test_job(
            started_by=self.user, job_type=LongRunningJob.JOB_CLUSTER_ALL_FACES
        )
        self.assertFalse(cluster_all_faces(self.user, job.job_id))
        job.refresh_from_db()
        self.assertTrue(job.finished)
        self.assertFalse(job.failed)

    @override_settings(FEATURE_FACE_CLUSTER=False)
    @patch("api.jobs.queue.Chain")
    def test_train_faces_endpoint_refuses_when_disabled(self, chain_mock):
        response = self.client.post("/api/trainfaces/", format="json")

        self.assertEqual(403, response.status_code)
        self.assertEqual("permission_denied", response.json()["errors"][0]["code"])
        chain_mock.assert_not_called()
        self.assertEqual(0, LongRunningJob.objects.count())


class ScanPipelineFeatureFlagTest(TestCase):
    """The jobs a scan queues once every file has been read."""

    def setUp(self):
        self.user = create_test_user()
        self.user.scan_directory = tempfile.mkdtemp()
        self.user.save(update_fields=["scan_directory"])
        self.addCleanup(shutil.rmtree, self.user.scan_directory, ignore_errors=True)

    def _scan(self):
        with (
            patch("api.jobs.queue.AsyncTask") as task_mock,
            patch("api.jobs.queue.Chain") as chain_mock,
            patch("api.directory_watcher.scan_jobs.db.connections.close_all"),
            self.captureOnCommitCallbacks(execute=True),
        ):
            scan_photos(self.user, False, str(uuid.uuid4()))

        queued = [call.args[0] for call in task_mock.call_args_list]
        chained = [
            call.args[0] for call in chain_mock.return_value.append.call_args_list
        ]
        return queued, chained

    def test_every_job_is_queued_by_default(self):
        queued, chained = self._scan()

        self.assertIn(generate_tags, queued)
        self.assertIn(add_geolocation, queued)
        self.assertIn(scan_faces, chained)

    @override_settings(FEATURE_SCENE_CLASSIFICATION=False)
    def test_tagging_job_is_skipped_when_disabled(self):
        queued, _ = self._scan()

        self.assertNotIn(generate_tags, queued)
        self.assertIn(add_geolocation, queued)

    @override_settings(FEATURE_REVERSE_GEOCODING=False)
    def test_geolocation_job_is_skipped_when_disabled(self):
        queued, _ = self._scan()

        self.assertNotIn(add_geolocation, queued)
        self.assertIn(generate_tags, queued)

    @override_settings(FEATURE_FACE_DETECTION=False)
    def test_face_scan_is_skipped_when_disabled(self):
        queued, chained = self._scan()

        self.assertNotIn(scan_faces, chained + queued)
        # Alone, the embedding job is queued without a chain.
        self.assertIn(batch_calculate_clip_embedding, queued)
