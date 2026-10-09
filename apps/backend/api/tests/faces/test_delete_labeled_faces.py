"""Deleting a labeled face takes its photo out of that person.

DeleteFaces only sets ``deleted``; the face keeps its person, so every read of
"this person's photos" has to skip deleted faces, and the person's count and
cover have to be recomputed.
"""

from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from api.models import AlbumDate
from api.models.photo_search import PhotoSearch
from api.tests.utils import (
    create_test_face,
    create_test_person,
    create_test_photo,
    create_test_user,
)


class DeleteLabeledFacesTest(TestCase):
    def setUp(self):
        self.user = create_test_user()
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)
        now = timezone.now()
        self.kept = create_test_photo(owner=self.user, exif_timestamp=now)
        self.wrong = create_test_photo(owner=self.user, exif_timestamp=now)
        self.album = AlbumDate.objects.create(date=now.date(), owner=self.user)
        self.album.photos.add(self.kept, self.wrong)
        self.person = create_test_person(cluster_owner=self.user)
        self.kept_face = create_test_face(photo=self.kept, person=self.person)
        self.wrong_face = create_test_face(photo=self.wrong, person=self.person)
        self.person.cover_face = self.wrong_face
        self.person.cover_photo = self.wrong
        self.person._calculate_face_count()
        self.assertEqual(self.person.face_count, 2)

    def _delete_wrong_face(self):
        response = self.client.post(
            "/api/deletefaces/", {"face_ids": [self.wrong_face.id]}, format="json"
        )
        self.assertEqual(response.status_code, 200)
        self.person.refresh_from_db()

    def test_the_count_and_cover_drop_the_deleted_face(self):
        self._delete_wrong_face()
        self.assertEqual(self.person.face_count, 1)
        self.assertEqual(self.person.cover_face_id, self.kept_face.id)
        self.assertEqual(self.person.cover_photo_id, self.kept.id)

    def test_the_person_album_drops_the_photo(self):
        self._delete_wrong_face()
        params = {"person": self.person.id}
        days = self.client.get("/api/albums/date/list/", params).json()["results"]
        self.assertEqual([day["numberOfItems"] for day in days], [1])
        response = self.client.get(f"/api/albums/date/{self.album.id}/", params)
        items = response.json()["results"]["items"]
        self.assertEqual([item["image_hash"] for item in items], [self.kept.image_hash])

    def test_a_new_cover_comes_from_the_persons_own_photos(self):
        # Legacy data (#2047): faces on this user's photos labeled with
        # another user's person. Deleting one must not make a face on this
        # user's photos that person's cover.
        other = create_test_user()
        their_person = create_test_person(cluster_owner=other)
        create_test_face(photo=self.kept, person=their_person)
        mislabeled = create_test_face(photo=self.wrong, person=their_person)
        their_photo = create_test_photo(owner=other)
        their_face = create_test_face(photo=their_photo, person=their_person)
        their_person.cover_face = mislabeled
        their_person.cover_photo = self.wrong
        their_person.save()

        response = self.client.post(
            "/api/deletefaces/", {"face_ids": [mislabeled.id]}, format="json"
        )
        self.assertEqual(response.status_code, 200)
        their_person.refresh_from_db()
        self.assertEqual(their_person.cover_face_id, their_face.id)
        self.assertEqual(their_person.cover_photo_id, their_photo.id)

    def test_the_people_list_cover_skips_a_deleted_face(self):
        self.person.cover_face = None
        self.person.cover_photo = None
        self.person.save()
        self.kept_face.deleted = True
        self.kept_face.save()
        # Ordered by id, the first live face is now the second one.
        response = self.client.get("/api/persons/")
        row = next(p for p in response.json()["results"] if p["id"] == self.person.id)
        self.assertEqual(row["face_photo_url"], self.wrong.image_hash)

    def test_search_stops_finding_the_photo_by_the_person(self):
        self.person.name = "Zebulon"
        self.person.save()
        for photo in (self.kept, self.wrong):
            search = PhotoSearch.objects.get_or_create(photo=photo)[0]
            search.recreate_search_captions()
            search.save()

        self._delete_wrong_face()

        response = self.client.get("/api/photos/searchlist/", {"search": "Zebulon"})
        hashes = [
            item["image_hash"]
            for group in response.json()["results"]
            for item in group["items"]
        ]
        self.assertEqual(hashes, [self.kept.image_hash])

    def test_rebuilt_captions_skip_a_deleted_face(self):
        self.wrong_face.deleted = True
        self.wrong_face.save()
        search = PhotoSearch(photo=self.wrong)
        search.recreate_search_captions()
        self.assertNotIn(self.person.name, search.search_captions)
