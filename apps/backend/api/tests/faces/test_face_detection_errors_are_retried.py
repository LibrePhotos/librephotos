"""A face-service failure is a job error and the photo is scanned again (#2199).

The face service used to swallow every error and answer "no faces"; the job
counted the photo as done and the next incremental scan never looked at it
again. Now the error reaches the job, and ``Photo.faces_scanned_at`` (set
only when detection ran, or failed for good) picks which photos an
incremental Scan Faces covers.

The face sidecar is never called: ``api.runtime.sidecars.http.post`` is
patched to answer or fail the way the real one does.
"""

import os
import uuid
from unittest.mock import patch

import requests
from django.test import TestCase, override_settings
from PIL import Image

from api.directory_watcher import processing_jobs
from api.directory_watcher.processing_jobs import scan_faces
from api.faces import extractor
from api.faces.photo_faces import extract_faces
from api.models import LongRunningJob, Photo
from api.runtime import sidecars
from api.tests.utils import create_test_photo, create_test_user


def _response(status: int, body: bytes) -> requests.Response:
    response = requests.Response()
    response.status_code = status
    response._content = body
    response.headers["Content-Type"] = "application/json"
    response.url = sidecars.sidecar_url("face_recognition", "/face-locations")
    return response


NO_FACES = _response(200, b'{"face_locations": [], "encodings": []}')


def _write_thumbnail(
    test: TestCase, photo: Photo, size: tuple[int, int] = (64, 48)
) -> None:
    path = photo.thumbnail.thumbnail_big.path
    os.makedirs(os.path.dirname(path), exist_ok=True)
    Image.new("RGB", size, "white").save(path)
    test.addCleanup(os.remove, path)


def _scanned_at(photo: Photo):
    return Photo.objects.get(pk=photo.pk).faces_scanned_at


@override_settings(FEATURE_FACE_DETECTION=True)
class FaceDetectionErrorsAreRetriedTest(TestCase):
    def setUp(self):
        self.user = create_test_user()
        # No XMP regions: every photo goes to the face service.
        no_regions = patch.object(extractor, "extract_from_exif", return_value=None)
        no_regions.start()
        self.addCleanup(no_regions.stop)
        for name in ("generate_face_embeddings", "cluster_all_faces"):
            tail = patch.object(processing_jobs, name)
            tail.start()
            self.addCleanup(tail.stop)

    def _photo(self, size: tuple[int, int] = (64, 48)) -> Photo:
        photo = create_test_photo(owner=self.user)
        _write_thumbnail(self, photo, size)
        return photo

    def _scan(self, answers: dict[str, requests.Response | Exception]):
        """Run an incremental Scan Faces; ``answers`` maps a thumbnail path to its reply."""
        job_id = uuid.uuid4()
        seen: list[str] = []

        def post(url: str, json: dict, **kwargs: object) -> requests.Response:
            seen.append(json["source"])
            answer = answers.get(json["source"], NO_FACES)
            if isinstance(answer, Exception):
                raise answer
            return answer

        with patch.object(sidecars.http, "post", side_effect=post):
            scan_faces(self.user, job_id)
        return LongRunningJob.objects.get(job_id=str(job_id)), seen

    def test_a_photo_the_face_service_failed_on_is_a_job_error_and_scanned_again(self):
        failing = self._photo((64, 48))
        fine = self._photo((80, 60))
        failing_path = failing.thumbnail.thumbnail_big.path

        job, seen = self._scan(
            {failing_path: requests.ConnectionError("Connection refused")}
        )

        self.assertEqual(len(seen), 2)
        self.assertEqual(job.result["error_count"], 1)
        self.assertIn("Connection refused", job.result["error"])
        self.assertIsNone(_scanned_at(failing))
        self.assertIsNotNone(_scanned_at(fine))

        _, seen_again = self._scan({})

        self.assertEqual(seen_again, [failing_path])
        self.assertIsNotNone(_scanned_at(failing))

    def test_a_photo_without_faces_is_not_scanned_again(self):
        photo = self._photo()

        job, seen = self._scan({})

        self.assertEqual(len(seen), 1)
        self.assertNotIn("error_count", job.result or {})
        self.assertIsNotNone(_scanned_at(photo))
        _, seen_again = self._scan({})
        self.assertEqual(seen_again, [])

    def test_a_server_error_is_retried(self):
        photo = self._photo()
        path = photo.thumbnail.thumbnail_big.path

        job, _ = self._scan({path: _response(500, b'{"error": "out of memory"}')})

        self.assertEqual(job.result["error_count"], 1)
        self.assertIn("out of memory", job.result["error"])
        self.assertIsNone(_scanned_at(photo))

    def test_a_picture_the_face_service_cannot_read_is_not_retried(self):
        """422: the sidecar could not open the image; asking again changes nothing."""
        photo = self._photo()
        path = photo.thumbnail.thumbnail_big.path

        job, _ = self._scan(
            {path: _response(422, b'{"error": "cannot identify image file"}')}
        )

        self.assertEqual(job.result["error_count"], 1)
        self.assertIsNotNone(_scanned_at(photo))
        _, seen_again = self._scan({})
        self.assertEqual(seen_again, [])

    def test_a_thumbnail_that_is_not_a_picture_is_not_retried(self):
        photo = create_test_photo(owner=self.user)
        path = photo.thumbnail.thumbnail_big.path
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "wb") as broken:
            broken.write(b"not a picture")
        self.addCleanup(os.remove, path)

        job, seen = self._scan({})

        self.assertEqual(seen, [])
        self.assertEqual(job.result["error_count"], 1)
        self.assertIsNotNone(_scanned_at(photo))

    def test_rescan_faces_covers_photos_already_scanned(self):
        photo = self._photo()
        self._scan({})
        self.assertIsNotNone(_scanned_at(photo))

        with patch.object(sidecars.http, "post", return_value=NO_FACES) as post:
            scan_faces(self.user, uuid.uuid4(), full_scan=True)

        post.assert_called_once()

    def test_a_failure_before_the_photo_loop_skips_embeddings_and_clustering(self):
        self._photo()

        with (
            patch.object(
                processing_jobs,
                "_begin_photo_scan",
                side_effect=RuntimeError("database gone"),
            ),
            patch.object(processing_jobs, "cluster_all_faces") as cluster,
            patch.object(processing_jobs, "generate_face_embeddings") as embed,
        ):
            scan_faces(self.user, uuid.uuid4())

        cluster.assert_not_called()
        embed.assert_not_called()


@override_settings(FEATURE_FACE_DETECTION=True)
class ExtractFacesMarksPhotoScannedTest(TestCase):
    """``extract_faces`` is also the upload path's last step."""

    def setUp(self):
        self.user = create_test_user()
        no_regions = patch.object(extractor, "extract_from_exif", return_value=None)
        no_regions.start()
        self.addCleanup(no_regions.stop)

    def test_successful_detection_marks_the_photo_scanned(self):
        photo = create_test_photo(owner=self.user)
        _write_thumbnail(self, photo)

        with patch.object(sidecars.http, "post", return_value=NO_FACES):
            extract_faces(photo)

        self.assertIsNotNone(_scanned_at(photo))

    def test_the_face_service_error_propagates(self):
        photo = create_test_photo(owner=self.user)
        _write_thumbnail(self, photo)

        with (
            patch.object(
                sidecars.http,
                "post",
                side_effect=requests.ConnectionError("Connection refused"),
            ),
            self.assertRaises(requests.ConnectionError),
        ):
            extract_faces(photo)

        self.assertIsNone(_scanned_at(photo))

    @override_settings(FEATURE_FACE_DETECTION=False)
    def test_disabled_face_detection_leaves_the_photo_unscanned(self):
        photo = create_test_photo(owner=self.user)

        extract_faces(photo)

        self.assertIsNone(_scanned_at(photo))
