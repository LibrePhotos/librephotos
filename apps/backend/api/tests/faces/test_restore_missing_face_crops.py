"""Scan Faces gives a face without a crop its crop back (#2642).

``Face.image`` is nullable: legacy rows and a crop that failed to save have no
file name. Such a face is listed (#2632) and shown as a placeholder (#2636),
but nothing ever cut its crop again. Its box is in big-thumbnail pixels, so the
next Scan Faces, incremental or full, cuts it from the big thumbnail, without
asking the face service.
"""

import os
import uuid
from unittest.mock import patch

import requests
from django.test import TestCase, override_settings
from django.utils import timezone
from PIL import Image

from api.directory_watcher import processing_jobs
from api.directory_watcher.processing_jobs import scan_faces
from api.faces import extractor
from api.models import LongRunningJob, Photo
from api.models.face import Face
from api.runtime import sidecars
from api.tests.utils import create_test_face, create_test_photo, create_test_user


def _no_faces(url: str, **kwargs: object) -> requests.Response:
    response = requests.Response()
    response.status_code = 200
    response._content = b'{"face_locations": [], "encodings": []}'
    response.headers["Content-Type"] = "application/json"
    response.url = url
    return response


@override_settings(FEATURE_FACE_DETECTION=True)
class RestoreMissingFaceCropsTest(TestCase):
    def setUp(self) -> None:
        self.user = create_test_user()
        no_regions = patch.object(extractor, "extract_from_exif", return_value=None)
        no_regions.start()
        self.addCleanup(no_regions.stop)
        for name in ("generate_face_embeddings", "cluster_all_faces"):
            tail = patch.object(processing_jobs, name)
            tail.start()
            self.addCleanup(tail.stop)

    def _photo(self, size: tuple[int, int] = (80, 60), owner: object = None) -> Photo:
        photo = create_test_photo(owner=owner or self.user)
        path = photo.thumbnail.thumbnail_big.path
        os.makedirs(os.path.dirname(path), exist_ok=True)
        # Left half red, right half blue: the crop shows which part was cut
        thumbnail = Image.new("RGB", size, "red")
        thumbnail.paste("blue", (size[0] // 2, 0, size[0], size[1]))
        thumbnail.save(path)
        self.addCleanup(os.remove, path)
        # Already scanned: an incremental scan does not detect faces on it again
        Photo.objects.filter(pk=photo.pk).update(faces_scanned_at=timezone.now())
        return photo

    def _face(
        self,
        photo: Photo,
        box: tuple[int, int, int, int] = (10, 70, 40, 50),
        image: str | None = "",
        deleted: bool = False,
    ) -> Face:
        top, right, bottom, left = box
        return create_test_face(
            photo=photo,
            image=image,
            deleted=deleted,
            location_top=top,
            location_right=right,
            location_bottom=bottom,
            location_left=left,
        )

    def _scan(self, full_scan: bool = False) -> LongRunningJob:
        job_id = uuid.uuid4()
        with patch.object(sidecars.http, "post", side_effect=_no_faces) as post:
            scan_faces(self.user, job_id, full_scan=full_scan)
        self.face_service_calls = post.call_count
        return LongRunningJob.objects.get(job_id=str(job_id))

    def _crop(self, face: Face) -> Image.Image:
        face.refresh_from_db()
        self.assertTrue(face.image, "the face still has no crop")
        self.addCleanup(face.image.delete, save=False)
        with Image.open(face.image.path) as crop:
            crop.load()
            return crop

    def test_an_incremental_scan_cuts_the_crop_from_the_big_thumbnail(self) -> None:
        photo = self._photo()
        # (top, right, bottom, left): 20 px wide, 30 px high, in the blue half
        face = self._face(photo, (10, 70, 40, 50))

        job = self._scan()

        crop = self._crop(face)
        self.assertEqual(crop.size, (20, 30))
        red, green, blue = crop.convert("RGB").getpixel((10, 15))
        self.assertGreater(blue, 200)
        self.assertLess(red, 60)
        self.assertTrue(face.image.name.startswith("faces/"))
        self.assertEqual(self.face_service_calls, 0)
        self.assertTrue(job.finished)
        self.assertFalse(job.failed)

    def test_a_face_with_a_null_crop_gets_one_too(self) -> None:
        face = self._face(self._photo(), image=None)

        self._scan(full_scan=True)

        self.assertEqual(self._crop(face).size, (20, 30))

    def test_a_box_reaching_past_the_thumbnail_is_cut_at_its_edge(self) -> None:
        face = self._face(self._photo((80, 60)), (50, 90, 70, 60))

        self._scan()

        self.assertEqual(self._crop(face).size, (20, 10))

    def test_faces_that_cannot_be_cut_keep_no_crop_and_the_job_goes_on(self) -> None:
        photo = self._photo()
        outside = self._face(photo, (100, 300, 200, 200))
        empty = self._face(photo, (20, 30, 20, 10))
        no_thumbnail = create_test_photo(owner=self.user)
        Photo.objects.filter(pk=no_thumbnail.pk).update(faces_scanned_at=timezone.now())
        missing = self._face(no_thumbnail)
        not_a_picture = self._photo()
        with open(not_a_picture.thumbnail.thumbnail_big.path, "wb") as thumbnail:
            thumbnail.write(b"not a picture")
        unreadable = self._face(not_a_picture)
        fine = self._face(photo)

        job = self._scan()

        for face in (outside, empty, missing, unreadable):
            face.refresh_from_db()
            self.assertFalse(face.image)
        self.assertEqual(self._crop(fine).size, (20, 30))
        self.assertTrue(job.finished)
        self.assertFalse(job.failed)

    def test_deleted_faces_faces_with_a_crop_and_other_users_faces_are_left(
        self,
    ) -> None:
        photo = self._photo()
        deleted = self._face(photo, deleted=True)
        with_crop = self._face(photo, image="faces/kept.jpg")
        other_user = create_test_user()
        others = self._face(self._photo(owner=other_user))

        self._scan()

        deleted.refresh_from_db()
        with_crop.refresh_from_db()
        others.refresh_from_db()
        self.assertFalse(deleted.image)
        self.assertEqual(with_crop.image.name, "faces/kept.jpg")
        self.assertFalse(others.image)
