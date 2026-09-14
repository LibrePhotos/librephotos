"""Adding a face the detector missed (issue #431).

``POST /api/addface`` takes a box the user drew on a photo, normalized to the
displayed image, and turns it into a real ``Face`` row: cropped face image,
person label, and an ArcFace encoding so classification can learn from it.

The box is normalized because that is what a browser can measure. Face rows
store pixels in big-thumbnail space, and the lightbox displays the big
thumbnail, so these tests pin the conversion against a thumbnail of a known
size and check the pixels that come out.
"""

import shutil
import tempfile
from unittest.mock import patch

import numpy as np
import PIL.Image
from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from api.models import Face, Person
from api.tests.utils import (
    create_test_face,
    create_test_person,
    create_test_photo,
    create_test_user,
)

ADD_FACE_URL = "/api/addface"
THUMB_WIDTH, THUMB_HEIGHT = 800, 600


def a_box(top=0.25, right=0.6, bottom=0.75, left=0.4):
    return {"top": top, "right": right, "bottom": bottom, "left": left}


class AddFaceTestBase(TestCase):
    def setUp(self):
        self.media = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.media, ignore_errors=True)
        overridden = override_settings(MEDIA_ROOT=self.media)
        overridden.enable()
        self.addCleanup(overridden.disable)

        self.client = APIClient()
        self.user = create_test_user()
        self.client.force_authenticate(user=self.user)
        self.photo = self._photo_with_thumbnail(self.user)

    def _photo_with_thumbnail(self, owner, name="thumb"):
        relative = f"thumbnails_big/{name}.jpg"
        photo = create_test_photo(owner=owner, thumbnail_big=relative)
        directory = f"{self.media}/thumbnails_big"
        PIL.Image.new("RGB", (THUMB_WIDTH, THUMB_HEIGHT), "gray").save(
            self._ensure(directory, f"{name}.jpg")
        )
        return photo

    @staticmethod
    def _ensure(directory, filename):
        import os

        os.makedirs(directory, exist_ok=True)
        return f"{directory}/{filename}"

    def _post(self, **overrides):
        payload = {
            "photo": self.photo.image_hash,
            "person_name": "Alice",
            "box": a_box(),
        }
        payload.update(overrides)
        return self.client.post(ADD_FACE_URL, payload, format="json")


@patch(
    "api.models.face.get_face_encodings",
    return_value=[np.random.rand(512)],
)
class AddFaceTest(AddFaceTestBase):
    def test_a_drawn_box_becomes_a_labelled_face(self, mock_encodings):
        response = self._post()

        self.assertEqual(response.status_code, 201)
        face = Face.objects.get()
        self.assertEqual(face.photo_id, self.photo.pk)
        self.assertEqual(face.person.name, "Alice")
        self.assertEqual(face.person.kind, Person.KIND_USER)
        self.assertEqual(face.person.cluster_owner, self.user)
        self.assertEqual(response.data["face"]["face_id"], face.id)

    def test_the_normalized_box_lands_on_the_right_pixels(self, mock_encodings):
        self._post(box=a_box(top=0.25, right=0.6, bottom=0.75, left=0.4))

        face = Face.objects.get()

        self.assertEqual(face.location_top, int(0.25 * THUMB_HEIGHT))
        self.assertEqual(face.location_bottom, int(0.75 * THUMB_HEIGHT))
        self.assertEqual(face.location_left, int(0.4 * THUMB_WIDTH))
        self.assertEqual(face.location_right, int(0.6 * THUMB_WIDTH))

    def test_the_face_image_is_cropped_to_the_box(self, mock_encodings):
        self._post(box=a_box(top=0.0, right=0.5, bottom=0.5, left=0.0))

        face = Face.objects.get()

        self.assertTrue(face.image.name.startswith("faces/"))
        with PIL.Image.open(face.image.path) as cropped:
            self.assertEqual(cropped.width, THUMB_WIDTH // 2)
            self.assertEqual(cropped.height, THUMB_HEIGHT // 2)

    def test_the_face_is_encoded_so_classification_can_learn_from_it(
        self, mock_encodings
    ):
        self._post()

        face = Face.objects.get()

        self.assertTrue(face.encoding)
        mock_encodings.assert_called_once()

    def test_a_manual_face_does_not_seed_a_cluster(self, mock_encodings):
        """It is a user label, so it trains classification but starts no cluster."""
        self._post()

        face = Face.objects.get()

        self.assertIsNone(face.cluster)
        self.assertIsNone(face.cluster_person)
        self.assertIsNone(face.classification_person)

    def test_the_person_gets_a_face_count_and_a_cover(self, mock_encodings):
        self._post()

        person = Person.objects.get(name="Alice")

        self.assertEqual(person.face_count, 1)
        self.assertEqual(person.cover_photo_id, self.photo.pk)

    def test_the_photo_now_lists_the_person(self, mock_encodings):
        """The end the user actually sees: the sidebar names them on the photo."""
        self._post()

        detail = self.client.get(f"/api/photos/{self.photo.image_hash}/")

        self.assertEqual(
            [(p["name"], p["type"]) for p in detail.data["people"]], [("Alice", "user")]
        )

    def test_the_person_becomes_searchable_on_that_photo(self, mock_encodings):
        self._post()

        self.photo.refresh_from_db()

        self.assertIn("Alice", self.photo.search_instance.search_captions)

    def test_an_existing_person_is_reused_rather_than_duplicated(self, mock_encodings):
        create_test_person(name="Alice", kind=Person.KIND_USER, cluster_owner=self.user)

        self._post()

        self.assertEqual(
            Person.objects.filter(name="Alice", cluster_owner=self.user).count(), 1
        )

    def test_a_second_face_can_be_added_elsewhere_on_the_photo(self, mock_encodings):
        self.assertEqual(self._post(box=a_box(0.1, 0.3, 0.4, 0.1)).status_code, 201)

        response = self._post(person_name="Bob", box=a_box(0.5, 0.9, 0.8, 0.7))

        self.assertEqual(response.status_code, 201)
        self.assertEqual(Face.objects.count(), 2)


@patch(
    "api.models.face.get_face_encodings",
    return_value=[np.random.rand(512)],
)
class AddFaceValidationTest(AddFaceTestBase):
    def test_a_blank_person_name_is_rejected(self, mock_encodings):
        for name in ("", "   "):
            with self.subTest(name=name):
                response = self._post(person_name=name)

                self.assertEqual(response.status_code, 400)
                self.assertFalse(Face.objects.exists())

    def test_the_placeholder_person_is_rejected(self, mock_encodings):
        """ "Unknown - Other" is what the algorithms use, not a name for a face."""
        response = self._post(person_name=Person.UNKNOWN_PERSON_NAME)

        self.assertEqual(response.status_code, 400)
        self.assertFalse(Face.objects.exists())

    def test_surrounding_whitespace_is_trimmed(self, mock_encodings):
        self._post(person_name="  Alice  ")

        self.assertTrue(Person.objects.filter(name="Alice").exists())

    def test_a_box_outside_the_image_is_rejected(self, mock_encodings):
        for box in (a_box(top=-0.1), a_box(right=1.4)):
            with self.subTest(box=box):
                self.assertEqual(self._post(box=box).status_code, 400)

    def test_an_inverted_box_is_rejected(self, mock_encodings):
        response = self._post(box=a_box(top=0.8, bottom=0.2))

        self.assertEqual(response.status_code, 400)

    def test_a_stray_click_is_rejected_as_too_small(self, mock_encodings):
        response = self._post(box=a_box(top=0.5, bottom=0.501, left=0.5, right=0.501))

        self.assertEqual(response.status_code, 400)
        self.assertFalse(Face.objects.exists())

    def test_a_missing_or_malformed_box_is_rejected(self, mock_encodings):
        for box in (None, "somewhere", {"top": 0.1}):
            with self.subTest(box=box):
                self.assertEqual(self._post(box=box).status_code, 400)

    def test_a_missing_photo_is_rejected(self, mock_encodings):
        response = self._post(photo="")

        self.assertEqual(response.status_code, 400)

    def test_another_users_photo_is_not_found(self, mock_encodings):
        stranger = create_test_user()
        their_photo = self._photo_with_thumbnail(stranger, name="theirs")

        response = self._post(photo=their_photo.image_hash)

        self.assertEqual(response.status_code, 404)
        self.assertFalse(Face.objects.exists())

    def test_a_photo_without_a_big_thumbnail_is_rejected(self, mock_encodings):
        no_thumbnail = create_test_photo(owner=self.user, thumbnail_big=None)

        response = self._post(photo=no_thumbnail.image_hash)

        self.assertEqual(response.status_code, 400)


@patch(
    "api.models.face.get_face_encodings",
    return_value=[np.random.rand(512)],
)
class AddFaceOverlapTest(AddFaceTestBase):
    def test_drawing_over_an_existing_face_is_refused(self, mock_encodings):
        """Relabelling the face that is already there is the right action."""
        create_test_face(
            photo=self.photo,
            person=create_test_person(name="Bob", cluster_owner=self.user),
            location_top=150,
            location_bottom=450,
            location_left=320,
            location_right=480,
        )

        response = self._post()

        self.assertEqual(response.status_code, 409)
        self.assertEqual(Face.objects.count(), 1)

    def test_a_deleted_face_does_not_block_the_same_region(self, mock_encodings):
        """A rescan must not resurrect a deleted face, but the user may overrule it.

        Drawing a box there is an explicit statement that there is a face after
        all, so the deleted row is not treated as an obstacle.
        """
        create_test_face(
            photo=self.photo,
            person=None,
            deleted=True,
            location_top=150,
            location_bottom=450,
            location_left=320,
            location_right=480,
        )

        response = self._post()

        self.assertEqual(response.status_code, 201)
        self.assertEqual(Face.objects.filter(deleted=False).count(), 1)


class AddFaceWithoutTheFaceServiceTest(AddFaceTestBase):
    """The label is the user's work; the encoding is a nicety the ML adds."""

    @patch(
        "api.models.face.get_face_encodings",
        side_effect=ConnectionError("face service is down"),
    )
    def test_the_face_survives_a_face_service_that_is_down(self, mock_encodings):
        response = self._post()

        self.assertEqual(response.status_code, 201)
        face = Face.objects.get()
        self.assertEqual(face.person.name, "Alice")
        self.assertEqual(face.encoding, "")

    @patch("api.models.face.get_face_encodings", return_value=[])
    def test_the_face_survives_a_face_service_that_returns_nothing(
        self, mock_encodings
    ):
        response = self._post()

        self.assertEqual(response.status_code, 201)
        self.assertEqual(Face.objects.get().encoding, "")
