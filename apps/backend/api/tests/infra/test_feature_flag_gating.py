import os
import shutil
import tempfile
import uuid
from unittest.mock import MagicMock, patch

from django.conf import settings
from django.test import SimpleTestCase, TestCase, override_settings
from rest_framework.test import APIClient

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
from api.models import Face, LongRunningJob
from api.models.file import is_valid_media
from api.models.photo_caption import PhotoCaption
from api.tests.utils import (
    ONE_PIXEL_PNG,
    create_test_file,
    create_test_photo,
    create_test_user,
)
from librephotos.settings.production import _env_flag

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
            self.assertTrue(_env_flag("FEATURE_TEST"))
            self.assertFalse(_env_flag("FEATURE_TEST", default=False))

    def test_truthy_values(self):
        for value in ("true", "True", "TRUE", "1", "yes", "on", " On "):
            with patch.dict(os.environ, {"FEATURE_TEST": value}):
                self.assertTrue(_env_flag("FEATURE_TEST"), value)

    def test_falsy_values(self):
        for value in ("false", "False", "0", "no", "off", "", "nonsense"):
            with patch.dict(os.environ, {"FEATURE_TEST": value}):
                self.assertFalse(_env_flag("FEATURE_TEST"), value)


class FeatureFlagDefaultsTest(SimpleTestCase):
    def test_every_feature_is_on_out_of_the_box(self):
        for flag in FEATURE_FLAGS:
            self.assertTrue(getattr(settings, flag), flag)


class VideoFeatureFlagTest(TestCase):
    def setUp(self):
        self.user = create_test_user()

    def _is_valid_video(self):
        with patch("api.models.file.is_video", return_value=True):
            return is_valid_media(path="/data/clip.mp4", user=self.user)

    def test_video_is_admitted_by_default(self):
        self.assertTrue(self._is_valid_video())

    @override_settings(FEATURE_VIDEO=False)
    def test_video_is_rejected_when_disabled(self):
        self.assertFalse(self._is_valid_video())

    @override_settings(FEATURE_VIDEO=False)
    def test_images_are_still_admitted_when_video_is_disabled(self):
        with patch("api.models.file.is_video", return_value=False):
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

    @patch("requests.post")
    def test_tags_are_generated_by_default(self, post_mock):
        post_mock.return_value = MagicMock(ok=False, status_code=503)

        self.caption.generate_tag_captions()
        post_mock.assert_called_once()

    @override_settings(FEATURE_SCENE_CLASSIFICATION=False)
    @patch("requests.post")
    def test_tags_skipped_when_disabled(self, post_mock):
        self.caption.generate_tag_captions()
        post_mock.assert_not_called()


class ImageCaptioningFeatureFlagTest(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.user = create_test_user()
        self.client.force_authenticate(user=self.user)
        self.photo = create_test_photo(owner=self.user)
        self.caption = PhotoCaption.objects.create(photo=self.photo)

    @patch("api.models.photo_caption.generate_caption", return_value="a cat")
    def test_captions_are_generated_by_default(self, generate_caption_mock):
        self.assertTrue(self.caption.generate_captions_im2txt())
        generate_caption_mock.assert_called_once()

    @override_settings(FEATURE_IMAGE_CAPTIONING=False)
    @patch("api.models.photo_caption.generate_caption")
    def test_captions_skipped_when_disabled(self, generate_caption_mock):
        self.assertFalse(self.caption.generate_captions_im2txt())
        generate_caption_mock.assert_not_called()

    @override_settings(FEATURE_IMAGE_CAPTIONING=False)
    @patch("api.models.photo_caption.PhotoCaption.generate_captions_im2txt")
    def test_generate_caption_endpoint_refuses_when_disabled(
        self, generate_captions_mock
    ):
        response = self.client.post(
            "/api/photosedit/generateim2txt/",
            format="json",
            data={"image_hash": self.photo.image_hash},
        )

        self.assertEqual(403, response.status_code)
        self.assertFalse(response.json()["status"])
        generate_captions_mock.assert_not_called()


class FaceDetectionFeatureFlagTest(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.user = create_test_user()
        self.client.force_authenticate(user=self.user)
        self.photo = create_test_photo(owner=self.user)

    @patch("api.models.photo.PIL.Image.open")
    @patch("api.models.photo.face_extractor")
    def test_faces_are_extracted_by_default(self, face_extractor_mock, image_open_mock):
        face_extractor_mock.extract.return_value = []

        self.photo._extract_faces()
        face_extractor_mock.extract.assert_called_once()

    @override_settings(FEATURE_FACE_DETECTION=False)
    @patch("api.models.photo.PIL.Image.open")
    @patch("api.models.photo.face_extractor")
    def test_faces_are_not_extracted_when_disabled(
        self, face_extractor_mock, image_open_mock
    ):
        """The upload pipeline calls this directly, bypassing the scan gates."""
        self.photo._extract_faces()

        face_extractor_mock.extract.assert_not_called()
        self.assertEqual(0, Face.objects.filter(photo=self.photo).count())

    @patch("api.views.faces.do_all_models_exist", return_value=True)
    @patch("api.views.faces.Chain")
    def test_scan_faces_endpoint_starts_a_job_by_default(
        self, chain_mock, models_exist_mock
    ):
        response = self.client.post("/api/scanfaces/", format="json")

        self.assertEqual(200, response.status_code)
        self.assertTrue(response.json()["status"])
        chain_mock.return_value.run.assert_called_once()

    @override_settings(FEATURE_FACE_DETECTION=False)
    @patch("api.views.faces.do_all_models_exist", return_value=True)
    @patch("api.views.faces.Chain")
    def test_scan_faces_endpoint_refuses_when_disabled(
        self, chain_mock, models_exist_mock
    ):
        response = self.client.post("/api/scanfaces/", format="json")

        self.assertEqual(403, response.status_code)
        self.assertFalse(response.json()["status"])
        chain_mock.assert_not_called()


class FaceClusterFeatureFlagTest(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.user = create_test_user()
        self.client.force_authenticate(user=self.user)

    @patch("api.face_classify.AsyncTask")
    @patch("api.face_classify.create_all_clusters", return_value=0)
    def test_cluster_all_faces_runs_by_default(self, create_clusters_mock, task_mock):
        self.assertTrue(cluster_all_faces(self.user, uuid.uuid4()))
        create_clusters_mock.assert_called_once()

    @override_settings(FEATURE_FACE_CLUSTER=False)
    @patch("api.face_classify.AsyncTask")
    @patch("api.face_classify.create_all_clusters")
    def test_cluster_all_faces_skipped_when_disabled(
        self, create_clusters_mock, task_mock
    ):
        self.assertFalse(cluster_all_faces(self.user, uuid.uuid4()))
        create_clusters_mock.assert_not_called()
        self.assertEqual(0, LongRunningJob.objects.count())

    @override_settings(FEATURE_FACE_CLUSTER=False)
    @patch("api.views.faces.Chain")
    def test_train_faces_endpoint_refuses_when_disabled(self, chain_mock):
        response = self.client.post("/api/trainfaces/", format="json")

        self.assertEqual(403, response.status_code)
        self.assertFalse(response.json()["status"])
        chain_mock.assert_not_called()


class ScanPipelineFeatureFlagTest(TestCase):
    """The jobs a scan queues once every file has been read."""

    def setUp(self):
        self.user = create_test_user()
        self.user.scan_directory = tempfile.mkdtemp()
        self.user.save(update_fields=["scan_directory"])
        self.addCleanup(shutil.rmtree, self.user.scan_directory, ignore_errors=True)

    def _scan(self):
        with (
            patch("api.directory_watcher.scan_jobs.AsyncTask") as task_mock,
            patch("api.directory_watcher.scan_jobs.Chain") as chain_mock,
            patch("api.directory_watcher.scan_jobs.db.connections.close_all"),
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
        _, chained = self._scan()

        self.assertNotIn(scan_faces, chained)
        self.assertIn(batch_calculate_clip_embedding, chained)
