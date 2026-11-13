"""An exif service failure costs the face regions, not the face scan.

Face regions written by another photo manager are read from the file while
the faces are detected. The exif sidecar answering 500 for one file raised
``MetadataReadError`` out of the scan, and the faces the face service found
in that photo were never saved. The regions are optional: the photo gets the
detected faces and a warning names it.

Both sidecars are faked at ``api.runtime.sidecars.http.post``.
"""

import os
import uuid
from unittest.mock import patch

import requests
from django.test import TestCase, override_settings
from PIL import Image

from api.directory_watcher import processing_jobs
from api.directory_watcher.processing_jobs import scan_faces
from api.models import Face, LongRunningJob, Photo
from api.runtime import sidecars
from api.tests.utils import create_test_photo, create_test_user

ONE_FACE = b'{"face_locations": [[10, 50, 50, 10]], "encodings": [[0.5, 0.25]]}'


def _response(service: str, path: str, status: int, body: bytes) -> requests.Response:
    response = requests.Response()
    response.status_code = status
    response._content = body
    response.headers["Content-Type"] = "application/json"
    response.url = sidecars.sidecar_url(service, path)
    return response


def _post(url: str, json: dict[str, object], **kwargs: object) -> requests.Response:
    if url == sidecars.sidecar_url("exif", "/get-tags"):
        return _response("exif", "/get-tags", 500, b"Internal Server Error")
    return _response("face_recognition", "/face-locations", 200, ONE_FACE)


@override_settings(FEATURE_FACE_DETECTION=True)
class FaceRegionsUnreadableTest(TestCase):
    def setUp(self) -> None:
        self.user = create_test_user()
        for name in ("generate_face_embeddings", "cluster_all_faces"):
            tail = patch.object(processing_jobs, name)
            tail.start()
            self.addCleanup(tail.stop)

    def _photo(self) -> Photo:
        photo = create_test_photo(owner=self.user)
        path = photo.thumbnail.thumbnail_big.path
        os.makedirs(os.path.dirname(path), exist_ok=True)
        Image.new("RGB", (80, 60), "white").save(path)
        self.addCleanup(os.remove, path)
        return photo

    def test_the_detected_faces_are_saved_when_the_regions_cannot_be_read(
        self,
    ) -> None:
        photo = self._photo()
        job_id = uuid.uuid4()

        with (
            patch.object(sidecars.http, "post", side_effect=_post),
            self.assertLogs("api.faces.photo_faces", "WARNING") as logs,
        ):
            scan_faces(self.user, job_id)

        job = LongRunningJob.objects.get(job_id=str(job_id))
        self.assertNotIn("error_count", job.result or {})
        faces = Face.objects.filter(photo=photo)
        self.assertEqual(faces.count(), 1)
        self.assertEqual(
            (faces[0].location_top, faces[0].location_right),
            (10, 50),
        )
        self.assertIsNotNone(Photo.objects.get(pk=photo.pk).faces_scanned_at)
        self.assertTrue(
            any(photo.image_hash in line for line in logs.output), logs.output
        )
