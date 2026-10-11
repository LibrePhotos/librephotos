"""Grouped album details only return photos the grid can show.

``PhotoSummarySerializer`` renders ``aspectRatio`` from the thumbnail, and the
shared API client requires it to be a number. Every grid keeps to
``Photo.visible`` (not hidden, trashed or removed, with an aspect ratio), so a
photo outside it must not reach these endpoints either: one null aspect ratio
makes the client reject the whole response.
"""

from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from api.models import AlbumThing
from api.tests.utils import (
    create_test_face,
    create_test_person,
    create_test_photo,
    create_test_user,
    share_test_photos,
)


def _grouped_hashes(results):
    return {
        item["image_hash"]
        for group in results["grouped_photos"]
        for item in group["items"]
    }


class GroupedAlbumVisiblePhotosTest(TestCase):
    def setUp(self):
        self.user = create_test_user()
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)
        now = timezone.now()
        self.kept = create_test_photo(owner=self.user, exif_timestamp=now)
        # Not in Photo.visible: no aspect ratio yet, in the trash, removed.
        self.no_ratio = create_test_photo(
            owner=self.user, exif_timestamp=now, aspect_ratio=None
        )
        self.trashed = create_test_photo(
            owner=self.user, exif_timestamp=now, in_trashcan=True
        )
        self.removed = create_test_photo(
            owner=self.user, exif_timestamp=now, in_trashcan=True, removed=True
        )
        self.photos = [self.kept, self.no_ratio, self.trashed, self.removed]

    def test_person_album_returns_only_visible_photos(self):
        person = create_test_person(name="Ana", cluster_owner=self.user)
        for photo in self.photos:
            create_test_face(photo=photo, person=person)

        response = self.client.get(f"/api/albums/person/{person.id}/")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            _grouped_hashes(response.json()["results"]), {self.kept.image_hash}
        )

    def test_person_without_visible_photos_is_not_listed(self):
        person = create_test_person(name="Bo", cluster_owner=self.user)
        for photo in self.photos[1:]:
            create_test_face(photo=photo, person=person)

        response = self.client.get("/api/albums/person/")

        self.assertEqual(response.status_code, 200)
        ids = [row["id"] for row in response.json()["results"]]
        self.assertNotIn(str(person.id), ids)

    def test_thing_album_returns_only_visible_photos(self):
        album = AlbumThing.objects.create(
            title="beach", owner=self.user, thing_type="hashtag_attribute"
        )
        album.photos.add(*self.photos)

        response = self.client.get(f"/api/albums/thing/{album.id}/")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            _grouped_hashes(response.json()["results"]), {self.kept.image_hash}
        )

    def test_shared_from_me_returns_only_visible_photos(self):
        other = create_test_user()
        share_test_photos([photo.pk for photo in self.photos], other)

        response = self.client.get("/api/photos/shared/fromme/")

        self.assertEqual(response.status_code, 200)
        rows = response.json()["results"]
        self.assertEqual(
            {row["photo"]["image_hash"] for row in rows}, {self.kept.image_hash}
        )
        self.assertTrue(all(row["photo"]["aspectRatio"] is not None for row in rows))
