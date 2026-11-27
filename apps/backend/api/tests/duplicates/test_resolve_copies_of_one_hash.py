from django.test import TestCase
from rest_framework.test import APIClient

from api.models import Photo
from api.models.duplicate import Duplicate
from api.tests.utils import create_test_duplicate, create_test_photo, create_test_user


class ResolveCopiesOfOneHashTest(TestCase):
    def setUp(self) -> None:
        self.user = create_test_user()
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)
        self.first, self.second = sorted(
            (create_test_photo(owner=self.user) for _ in range(2)),
            key=lambda photo: photo.pk,
        )
        Photo.objects.filter(pk=self.second.pk).update(image_hash=self.first.image_hash)
        self.duplicate = create_test_duplicate(
            owner=self.user, duplicate_type=Duplicate.DuplicateType.EXACT_COPY
        )
        self.duplicate.photos.add(self.first, self.second)

    def _resolve(self, body: dict[str, object]):
        return self.client.post(
            f"/api/duplicates/{self.duplicate.id}/resolve/", body, format="json"
        )

    def _trashed(self) -> list[bool]:
        return [
            Photo.objects.get(pk=photo.pk).in_trashcan
            for photo in (self.first, self.second)
        ]

    def test_the_photo_given_by_id_is_kept(self) -> None:
        response = self._resolve({"keep_photo_id": str(self.second.pk)})

        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual([True, False], self._trashed())
        self.duplicate.refresh_from_db()
        self.assertEqual(self.second.pk, self.duplicate.kept_photo_id)

    def test_a_shared_hash_keeps_the_first_of_its_copies(self) -> None:
        response = self._resolve({"keep_photo_hash": self.first.image_hash})

        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual([False, True], self._trashed())

    def test_an_id_outside_the_group_is_a_400(self) -> None:
        outside = create_test_photo(owner=self.user)

        response = self._resolve({"keep_photo_id": str(outside.pk)})

        self.assertEqual(response.status_code, 400)

    def test_the_detail_marks_only_the_kept_copy(self) -> None:
        self._resolve({"keep_photo_id": str(self.second.pk)})

        photos = self.client.get(f"/api/duplicates/{self.duplicate.id}/").json()[
            "photos"
        ]

        kept = {photo["id"]: photo["is_kept"] for photo in photos}
        self.assertEqual({str(self.first.pk): False, str(self.second.pk): True}, kept)
