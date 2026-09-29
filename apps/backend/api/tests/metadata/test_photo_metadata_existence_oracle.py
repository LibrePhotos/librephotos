"""The photo metadata endpoints must not confirm that someone else's photo exists.

``PhotoMetadataViewSet._get_photo`` looked the photo up across every owner and
only then checked ownership, so a photo id or image hash belonging to another
user answered 403 while an unknown one answered 404. image_hash is the file's
MD5 plus the owner's user id, so anyone holding a file can compute the hash it
would have in another user's library and ask whether that user has the file:
the same existence oracle as GHSA-hq2w-x39h-8wmp, on
``/api/photos/<id>/metadata`` and its history, revert and revert-all actions.

A photo that is not the requester's (and the requester is not staff) now
answers exactly like a photo that does not exist. Staff keep their access to
every photo's metadata, which ``test_photo_metadata_api`` pins.
"""

import uuid

from rest_framework.test import APIClient, APITestCase

from api.models.photo_metadata import MetadataEdit, PhotoMetadata
from api.tests.utils import create_test_photo, create_test_user

UNKNOWN_HASH = "0" * 32 + "999"


class PhotoMetadataExistenceOracleTest(APITestCase):
    def setUp(self):
        self.owner = create_test_user()
        self.stranger = create_test_user()
        self.photo = create_test_photo(owner=self.owner)
        self.edit = MetadataEdit.objects.create(
            photo=self.photo,
            user=self.owner,
            field_name="title",
            old_value="",
            new_value="Private title",
        )
        self.client = APIClient()
        self.client.force_authenticate(user=self.stranger)

    def _identifiers(self):
        # A foreign photo by hash and by UUID, next to the same kind of
        # identifier for a photo that does not exist at all.
        return [
            (self.photo.image_hash, UNKNOWN_HASH),
            (str(self.photo.pk), str(uuid.uuid4())),
        ]

    def _assert_same_answer(self, send):
        for foreign, unknown in self._identifiers():
            with self.subTest(identifier=foreign):
                foreign_response = send(foreign)
                unknown_response = send(unknown)
                self.assertEqual(unknown_response.status_code, 404)
                self.assertEqual(foreign_response.status_code, 404)
                self.assertEqual(foreign_response.data, unknown_response.data)

    def test_retrieve(self):
        self._assert_same_answer(
            lambda photo_id: self.client.get(f"/api/photos/{photo_id}/metadata/")
        )

    def test_partial_update(self):
        self._assert_same_answer(
            lambda photo_id: self.client.patch(
                f"/api/photos/{photo_id}/metadata/",
                {"title": "Overwritten"},
                format="json",
            )
        )
        self.assertFalse(
            PhotoMetadata.objects.filter(photo=self.photo, title="Overwritten").exists()
        )

    def test_history(self):
        self._assert_same_answer(
            lambda photo_id: self.client.get(
                f"/api/photos/{photo_id}/metadata/history/"
            )
        )

    def test_revert(self):
        self._assert_same_answer(
            lambda photo_id: self.client.post(
                f"/api/photos/{photo_id}/metadata/revert/{self.edit.pk}/"
            )
        )
        self.assertEqual(MetadataEdit.objects.filter(photo=self.photo).count(), 1)

    def test_revert_all(self):
        self._assert_same_answer(
            lambda photo_id: self.client.post(
                f"/api/photos/{photo_id}/metadata/revert-all/"
            )
        )
        self.assertEqual(MetadataEdit.objects.filter(photo=self.photo).count(), 1)

    def test_photo_shared_to_the_requester_is_not_theirs_to_edit(self):
        # Sharing grants viewing, not metadata access; the answer is the same
        # 404 so the endpoint keeps a single "not yours" shape.
        self.photo.shared_to.add(self.stranger)
        response = self.client.patch(
            f"/api/photos/{self.photo.image_hash}/metadata/",
            {"title": "Overwritten"},
            format="json",
        )
        self.assertEqual(response.status_code, 404)

    def test_owner_still_reads_their_metadata(self):
        self.client.force_authenticate(user=self.owner)
        response = self.client.get(f"/api/photos/{self.photo.image_hash}/metadata/")
        self.assertEqual(response.status_code, 200)
