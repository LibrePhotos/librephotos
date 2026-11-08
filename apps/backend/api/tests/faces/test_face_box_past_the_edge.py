"""A face at the edge of a photo is saved, cut to the photo (#2922).

The face service gives a face that the edge of the picture cuts off a box
going past that edge: a negative top or left. Used as a numpy index, a
negative number counts from the far side, so the crop came out empty, saving
it raised "cannot write empty image" and the photo stayed unscanned forever.

The face sidecar is never called: ``api.runtime.sidecars.http.post`` is
patched to answer the way the real one does.
"""

import json
import os
from unittest.mock import patch

import numpy as np
import requests
from django.test import SimpleTestCase, TestCase, override_settings
from PIL import Image

from api.faces import extractor
from api.faces.geometry import box_in_picture
from api.faces.photo_faces import extract_faces
from api.models import Face, Photo
from api.runtime import sidecars
from api.tests.utils import create_test_photo, create_test_user

WIDTH, HEIGHT = 200, 100
# (top, right, bottom, left)
INSIDE = (20, 80, 60, 40)
PAST_THE_TOP = (-43, 150, 40, 110)
PAST_THE_LEFT = (30, 35, 90, -12)
PAST_EVERY_EDGE = (-10, 240, 110, -20)
BELOW_THE_PHOTO = (110, 80, 140, 40)


def _face_service(boxes: list[tuple[int, int, int, int]]) -> requests.Response:
    response = requests.Response()
    response.status_code = 200
    encodings = [[float(index + 1)] * 8 for index in range(len(boxes))]
    response._content = json.dumps(
        {"face_locations": boxes, "encodings": encodings}
    ).encode()
    response.headers["Content-Type"] = "application/json"
    return response


class BoxInPictureTest(SimpleTestCase):
    def test_a_box_inside_the_picture_is_kept_as_it_is(self) -> None:
        self.assertEqual(INSIDE, box_in_picture(INSIDE, WIDTH, HEIGHT))

    def test_a_box_past_an_edge_is_cut_to_it(self) -> None:
        cases = {
            PAST_THE_TOP: (0, 150, 40, 110),
            PAST_THE_LEFT: (30, 35, 90, 0),
            PAST_EVERY_EDGE: (0, WIDTH, HEIGHT, 0),
        }
        for box, cut in cases.items():
            with self.subTest(box=box):
                self.assertEqual(cut, box_in_picture(box, WIDTH, HEIGHT))

    def test_a_box_with_nothing_in_the_picture_is_none(self) -> None:
        boxes = (
            BELOW_THE_PHOTO,
            (-50, 80, -1, 40),  # above
            (20, 260, 60, 210),  # right of it
            (20, -5, 60, -30),  # left of it
            (20, 80, 20, 40),  # no height
        )
        for box in boxes:
            with self.subTest(box=box):
                self.assertIsNone(box_in_picture(box, WIDTH, HEIGHT))


@override_settings(FEATURE_FACE_DETECTION=True)
class FaceAtTheEdgeTest(TestCase):
    def setUp(self) -> None:
        self.user = create_test_user()
        self.photo = create_test_photo(owner=self.user)
        path = self.photo.thumbnail.thumbnail_big.path
        os.makedirs(os.path.dirname(path), exist_ok=True)
        Image.new("RGB", (WIDTH, HEIGHT), "white").save(path)
        self.addCleanup(os.remove, path)

    def scan(
        self,
        boxes: list[tuple[int, int, int, int]],
        regions: list[tuple[int, int, int, int, str]] | None = None,
    ) -> list[Face]:
        with (
            patch.object(extractor, "extract_from_exif", return_value=regions),
            patch.object(sidecars.http, "post", return_value=_face_service(boxes)),
        ):
            extract_faces(Photo.objects.get(pk=self.photo.pk))
        return list(Face.objects.filter(photo=self.photo).order_by("id"))

    def assert_saved_as(self, face: Face, box: tuple[int, int, int, int]) -> None:
        top, right, bottom, left = box
        self.assertEqual(
            box,
            (
                face.location_top,
                face.location_right,
                face.location_bottom,
                face.location_left,
            ),
        )
        with Image.open(face.image.path) as crop:
            self.assertEqual((right - left, bottom - top), crop.size)

    def test_faces_past_the_top_and_the_left_are_saved_cut_to_the_photo(self) -> None:
        top_face, left_face = self.scan([PAST_THE_TOP, PAST_THE_LEFT])

        self.assert_saved_as(top_face, (0, 150, 40, 110))
        self.assert_saved_as(left_face, (30, 35, 90, 0))
        self.photo.refresh_from_db()
        self.assertIsNotNone(self.photo.faces_scanned_at)

    def test_a_cut_face_keeps_the_encoding_the_face_service_sent(self) -> None:
        (face,) = self.scan([PAST_EVERY_EDGE])

        self.assert_saved_as(face, (0, WIDTH, HEIGHT, 0))
        self.assertEqual(np.full(8, 1.0).tobytes().hex(), face.encoding)

    def test_a_box_outside_the_photo_is_skipped_and_the_others_saved(self) -> None:
        (face,) = self.scan([BELOW_THE_PHOTO, INSIDE])

        self.assert_saved_as(face, INSIDE)
        self.photo.refresh_from_db()
        self.assertIsNotNone(self.photo.faces_scanned_at)

    def test_a_face_region_past_the_edge_is_imported_cut_to_the_photo(self) -> None:
        (face,) = self.scan([], regions=[(*PAST_THE_TOP, "Anna")])

        self.assert_saved_as(face, (0, 150, 40, 110))
        assert face.person is not None
        self.assertEqual("Anna", face.person.name)
