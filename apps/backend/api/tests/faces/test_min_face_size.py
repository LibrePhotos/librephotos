"""A minimum face size for face detection (#2749).

``User.min_face_size`` is a share of the big thumbnail's shorter side: a
detected face lower than that is not saved, so strangers far in the
background stay out of the Unknown tab. 0 keeps every face. Face regions
from the file are the user's own and always kept.

The face sidecar is never called: ``api.runtime.sidecars.http.post`` is
patched to answer the way the real one does.
"""

import json
import os
from unittest.mock import patch

import requests
from django.test import TestCase, override_settings
from PIL import Image
from rest_framework.test import APIClient

from api.faces import extractor
from api.faces.photo_faces import extract_faces
from api.models import Face, Photo, User
from api.runtime import sidecars
from api.tests.utils import create_test_photo, create_test_user

# The shorter side is 100 px: 4 % is 4 px.
THUMB_WIDTH, THUMB_HEIGHT = 200, 100
# (top, right, bottom, left)
LARGE = (20, 80, 60, 40)  # 40 px tall
TINY = (10, 150, 13, 147)  # 3 px tall


def _face_service(boxes: list[tuple[int, int, int, int]]) -> requests.Response:
    response = requests.Response()
    response.status_code = 200
    encodings = [[float(index)] * 8 for index in range(len(boxes))]
    response._content = json.dumps(
        {"face_locations": boxes, "encodings": encodings}
    ).encode()
    response.headers["Content-Type"] = "application/json"
    return response


@override_settings(FEATURE_FACE_DETECTION=True)
class MinFaceSizeDetectionTest(TestCase):
    def setUp(self) -> None:
        self.user = create_test_user()
        self.photo = create_test_photo(owner=self.user)
        path = self.photo.thumbnail.thumbnail_big.path
        os.makedirs(os.path.dirname(path), exist_ok=True)
        Image.new("RGB", (THUMB_WIDTH, THUMB_HEIGHT), "white").save(path)
        self.addCleanup(os.remove, path)

    def scan(
        self,
        min_face_size: float,
        boxes: list[tuple[int, int, int, int]],
        regions: list[tuple[int, int, int, int, str]] | None = None,
    ) -> set[tuple[int, int, int, int]]:
        User.objects.filter(pk=self.user.pk).update(min_face_size=min_face_size)
        with (
            patch.object(extractor, "extract_from_exif", return_value=regions),
            patch.object(sidecars.http, "post", return_value=_face_service(boxes)),
        ):
            extract_faces(Photo.objects.get(pk=self.photo.pk))
        return set(
            Face.objects.filter(photo=self.photo).values_list(
                "location_top", "location_right", "location_bottom", "location_left"
            )
        )

    def test_off_keeps_every_detected_face(self) -> None:
        self.assertEqual({LARGE, TINY}, self.scan(0, [LARGE, TINY]))

    def test_a_face_below_the_minimum_is_not_saved(self) -> None:
        self.assertEqual({LARGE}, self.scan(0.04, [LARGE, TINY]))

    def test_a_face_exactly_at_the_minimum_is_kept(self) -> None:
        self.assertEqual({LARGE, TINY}, self.scan(0.03, [LARGE, TINY]))

    def test_a_tiny_face_region_from_the_file_is_still_imported(self) -> None:
        faces = self.scan(0.08, [LARGE], regions=[(*TINY, "Tiny Tim")])

        self.assertEqual({LARGE, TINY}, faces)
        tim = Face.objects.get(photo=self.photo, location_top=TINY[0])
        self.assertIsNotNone(tim.person)


class MinFaceSizeSettingTest(TestCase):
    def setUp(self) -> None:
        self.user = create_test_user()
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)

    def patch(self, value: object) -> int:
        response = self.client.patch(
            f"/api/user/{self.user.pk}/", {"min_face_size": value}, format="json"
        )
        return response.status_code

    def test_the_setting_is_off_by_default(self) -> None:
        response = self.client.get(f"/api/user/{self.user.pk}/")

        self.assertEqual(0, response.json()["min_face_size"])

    def test_a_share_is_saved(self) -> None:
        self.assertEqual(200, self.patch(0.04))

        self.user.refresh_from_db()
        self.assertAlmostEqual(0.04, self.user.min_face_size)

    def test_a_share_outside_zero_to_a_half_is_refused(self) -> None:
        for value in (-0.01, 0.51, 4):
            with self.subTest(value=value):
                self.assertEqual(400, self.patch(value))

        self.user.refresh_from_db()
        self.assertEqual(0, self.user.min_face_size)
