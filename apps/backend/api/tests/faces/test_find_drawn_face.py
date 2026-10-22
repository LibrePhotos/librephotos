"""Draw roughly, the face is found in the box (#1117).

The detector misses small, turned or blurred faces on the whole photo. With
``fit`` the box a user draws only says where to look: the face service gets
that part of the photo alone, enlarged, and the face it finds there is saved
with its own box and a real encoding.
"""

import os
import shutil
import tempfile
from typing import Any
from unittest.mock import MagicMock, patch

import numpy as np
import PIL.Image
import requests
from django.test import SimpleTestCase, TestCase, override_settings
from rest_framework.test import APIClient

from api.faces import drawn_faces
from api.faces.drawn_faces import FaceServiceError, FoundFace, find_face_in_box
from api.models import Face
from api.tests.utils import create_test_face, create_test_photo, create_test_user

THUMB_WIDTH, THUMB_HEIGHT = 800, 600
# a_box() in thumbnail pixels: (top, right, bottom, left).
DRAWN = (150, 480, 450, 320)


class FindFaceInBoxTest(SimpleTestCase):
    def setUp(self) -> None:
        self.thumbnail = PIL.Image.new("RGB", (THUMB_WIDTH, THUMB_HEIGHT), "gray")
        self.sent: list[tuple[int, int]] = []

    def answer(self, *locations: list[int]) -> MagicMock:
        """The face service finding ``locations`` (in the picture it was sent)."""

        def detect(path: str) -> list[tuple[list[int], np.ndarray]]:
            with PIL.Image.open(path) as picture:
                self.sent.append(picture.size)
            return [
                (location, np.full(512, index))
                for index, location in enumerate(locations)
            ]

        return MagicMock(side_effect=detect)

    def test_the_box_with_a_margin_is_sent_enlarged(self) -> None:
        with patch.object(drawn_faces, "detect_faces", self.answer()):
            find_face_in_box(self.thumbnail, DRAWN)

        # 160 x 300 with half a side on each side is 320 x 600 (cut at the
        # bottom and top of the thumbnail), enlarged to 640 high.
        self.assertEqual([(341, 640)], self.sent)

    def test_a_large_box_is_not_shrunk(self) -> None:
        with patch.object(drawn_faces, "detect_faces", self.answer()):
            find_face_in_box(self.thumbnail, (0, 800, 600, 0))

        self.assertEqual([(800, 600)], self.sent)

    def test_the_face_found_comes_back_in_thumbnail_pixels(self) -> None:
        scale = 640 / 600
        # A face at thumbnail (200, 440, 400, 360); the crop starts at (0, 240).
        in_crop = [
            round(200 * scale),
            round(200 * scale),
            round(400 * scale),
            round(120 * scale),
        ]

        with patch.object(drawn_faces, "detect_faces", self.answer(in_crop)):
            found = find_face_in_box(self.thumbnail, DRAWN)

        assert found is not None
        for side, expected in zip(found.box, (200, 440, 400, 360)):
            self.assertAlmostEqual(expected, side, delta=1)
        assert found.encoding is not None
        self.assertEqual(512, len(found.encoding))

    def test_a_face_centred_outside_the_box_is_not_taken(self) -> None:
        # The neighbour on the left, inside the margin only.
        with patch.object(drawn_faces, "detect_faces", self.answer([200, 70, 300, 10])):
            self.assertIsNone(find_face_in_box(self.thumbnail, DRAWN))

    def test_of_two_faces_in_the_box_the_one_filling_it_most_is_taken(self) -> None:
        small = [300, 230, 340, 190]
        filling = [170, 250, 470, 90]

        with patch.object(drawn_faces, "detect_faces", self.answer(small, filling)):
            found = find_face_in_box(self.thumbnail, DRAWN)

        assert found is not None and found.encoding is not None
        self.assertEqual(1, found.encoding[0])

    def test_no_face_found_is_none(self) -> None:
        with patch.object(drawn_faces, "detect_faces", self.answer()):
            self.assertIsNone(find_face_in_box(self.thumbnail, DRAWN))

    def test_a_face_service_failure_is_raised_as_such(self) -> None:
        failing = MagicMock(side_effect=requests.ConnectionError("refused"))
        with patch.object(drawn_faces, "detect_faces", failing):
            with self.assertRaises(FaceServiceError):
                find_face_in_box(self.thumbnail, DRAWN)


FOUND = FoundFace((200, 440, 400, 360), np.full(512, 0.5))


@patch("api.views.faces.feature_enabled", return_value=True)
@patch("api.faces.photo_faces.get_face_encodings", return_value=[np.random.rand(512)])
class AddFaceFitTest(TestCase):
    def setUp(self) -> None:
        self.media = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.media, ignore_errors=True)
        overridden = override_settings(MEDIA_ROOT=self.media)
        overridden.enable()
        self.addCleanup(overridden.disable)
        self.client = APIClient()
        self.user = create_test_user()
        self.client.force_authenticate(user=self.user)
        self.photo = create_test_photo(
            owner=self.user, thumbnail_big="thumbnails_big/thumb.jpg"
        )
        os.makedirs(f"{self.media}/thumbnails_big", exist_ok=True)
        PIL.Image.new("RGB", (THUMB_WIDTH, THUMB_HEIGHT), "gray").save(
            f"{self.media}/thumbnails_big/thumb.jpg"
        )

    def post(self, fit: bool | None = True) -> Any:
        payload: dict[str, object] = {
            "photo": self.photo.image_hash,
            "person_name": "Alice",
            "box": {"top": 0.25, "right": 0.6, "bottom": 0.75, "left": 0.4},
        }
        if fit is not None:
            payload["fit"] = fit
        return self.client.post("/api/addface", payload, format="json")

    def box_of(self, face: Face) -> tuple[int, int, int, int]:
        return (
            face.location_top,
            face.location_right,
            face.location_bottom,
            face.location_left,
        )

    def test_the_face_found_is_saved_with_its_box_and_encoding(
        self, encode: MagicMock, enabled: MagicMock
    ) -> None:
        with patch("api.views.faces.find_face_in_box", return_value=FOUND):
            response = self.post()

        self.assertEqual(201, response.status_code, response.content)
        self.assertTrue(response.json()["fitted"])
        face = Face.objects.get(photo=self.photo)
        self.assertEqual((200, 440, 400, 360), self.box_of(face))
        np.testing.assert_allclose(
            FOUND.encoding, face.get_encoding_array() * np.linalg.norm(FOUND.encoding)
        )
        encode.assert_not_called()

    def test_no_face_in_the_box_saves_nothing(
        self, encode: MagicMock, enabled: MagicMock
    ) -> None:
        with patch("api.views.faces.find_face_in_box", return_value=None):
            response = self.post()

        self.assertEqual(400, response.status_code, response.content)
        self.assertEqual("no_face_in_box", response.json()["errors"][0]["code"])
        self.assertFalse(Face.objects.filter(photo=self.photo).exists())

    def test_keep_my_box_saves_it_as_drawn(
        self, encode: MagicMock, enabled: MagicMock
    ) -> None:
        finding = MagicMock(return_value=None)
        with patch("api.views.faces.find_face_in_box", finding):
            response = self.post(fit=False)

        self.assertEqual(201, response.status_code, response.content)
        self.assertFalse(response.json()["fitted"])
        finding.assert_not_called()
        self.assertEqual(DRAWN, self.box_of(Face.objects.get(photo=self.photo)))
        encode.assert_called_once()

    def test_an_older_client_gets_the_box_as_drawn(
        self, encode: MagicMock, enabled: MagicMock
    ) -> None:
        with patch("api.views.faces.find_face_in_box") as finding:
            response = self.post(fit=None)

        self.assertEqual(201, response.status_code, response.content)
        finding.assert_not_called()

    def test_a_failing_face_service_keeps_the_box_as_drawn(
        self, encode: MagicMock, enabled: MagicMock
    ) -> None:
        failing = MagicMock(side_effect=FaceServiceError("down"))
        with patch("api.views.faces.find_face_in_box", failing):
            response = self.post()

        self.assertEqual(201, response.status_code, response.content)
        self.assertFalse(response.json()["fitted"])
        self.assertEqual(DRAWN, self.box_of(Face.objects.get(photo=self.photo)))

    def test_face_detection_off_keeps_the_box_as_drawn(
        self, encode: MagicMock, enabled: MagicMock
    ) -> None:
        enabled.return_value = False
        with patch("api.views.faces.find_face_in_box") as finding:
            response = self.post()

        self.assertEqual(201, response.status_code, response.content)
        finding.assert_not_called()

    def test_a_found_face_over_an_existing_one_is_refused(
        self, encode: MagicMock, enabled: MagicMock
    ) -> None:
        create_test_face(
            photo=self.photo,
            location_top=200,
            location_right=440,
            location_bottom=400,
            location_left=360,
        )
        with patch("api.views.faces.find_face_in_box", return_value=FOUND):
            response = self.post()

        self.assertEqual(409, response.status_code, response.content)
