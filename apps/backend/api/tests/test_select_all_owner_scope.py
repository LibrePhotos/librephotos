"""Regression tests: select_all bulk operations must never write to other
users' photos.

build_photo_queryset(user, {"public": True}) intentionally drops the owner
filter so public browsing works, which means every select_all branch that
feeds it into a write must re-scope to owner=request.user itself. These
tests pin that property for the favorite, share, and delete endpoints
(the hide/makepublic/setdeleted counterparts are covered by their own
fixes, see #1980/#1981/#1982).
"""

from django.test import TestCase
from rest_framework.test import APIClient

from api.models import Photo
from api.tests.utils import create_test_photos, create_test_user


class FavoriteSelectAllOwnerScopeTest(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.attacker = create_test_user()
        self.victim = create_test_user()
        self.client.force_authenticate(user=self.attacker)

    def test_public_query_cannot_favorite_other_users_photos(self):
        victim_photos = create_test_photos(
            number_of_photos=3, owner=self.victim, public=True, rating=0
        )
        own_photos = create_test_photos(
            number_of_photos=2, owner=self.attacker, public=True, rating=0
        )

        payload = {
            "select_all": True,
            "query": {"public": True},
            "favorite": True,
        }
        response = self.client.post(
            "/api/photosedit/favorite/", format="json", data=payload
        )
        data = response.json()

        self.assertTrue(data["status"])
        # Only the attacker's own photos may be touched
        self.assertEqual(data["count"], 2)
        for photo in victim_photos:
            photo.refresh_from_db()
            self.assertEqual(photo.rating, 0)
        for photo in own_photos:
            photo.refresh_from_db()
            self.assertGreaterEqual(photo.rating, self.attacker.favorite_min_rating)

    def test_public_query_cannot_unfavorite_other_users_photos(self):
        victim_rating = self.victim.favorite_min_rating
        victim_photos = create_test_photos(
            number_of_photos=3, owner=self.victim, public=True, rating=victim_rating
        )

        payload = {
            "select_all": True,
            "query": {"public": True},
            "favorite": False,
        }
        response = self.client.post(
            "/api/photosedit/favorite/", format="json", data=payload
        )
        data = response.json()

        self.assertTrue(data["status"])
        self.assertEqual(data["count"], 0)
        for photo in victim_photos:
            photo.refresh_from_db()
            self.assertEqual(photo.rating, victim_rating)


class ShareSelectAllOwnerScopeTest(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.attacker = create_test_user()
        self.victim = create_test_user()
        self.target = create_test_user()
        self.client.force_authenticate(user=self.attacker)

    def test_public_query_cannot_share_other_users_photos(self):
        victim_photos = create_test_photos(
            number_of_photos=3, owner=self.victim, public=True
        )
        create_test_photos(number_of_photos=2, owner=self.attacker, public=True)

        payload = {
            "select_all": True,
            "query": {"public": True},
            "val_shared": True,
            "target_user_id": self.target.id,
        }
        response = self.client.post(
            "/api/photosedit/share/", format="json", data=payload
        )
        data = response.json()

        self.assertTrue(data["status"])
        self.assertEqual(data["count"], 2)

        through_model = Photo.shared_to.through
        victim_shared = through_model.objects.filter(
            user_id=self.target.id,
            photo_id__in=[photo.id for photo in victim_photos],
        ).count()
        self.assertEqual(victim_shared, 0)

    def test_public_query_cannot_unshare_other_users_photos(self):
        victim_photos = create_test_photos(
            number_of_photos=2, owner=self.victim, public=True
        )
        through_model = Photo.shared_to.through
        through_model.objects.bulk_create(
            [
                through_model(user_id=self.target.id, photo_id=photo.id)
                for photo in victim_photos
            ]
        )

        payload = {
            "select_all": True,
            "query": {"public": True},
            "val_shared": False,
            "target_user_id": self.target.id,
        }
        response = self.client.post(
            "/api/photosedit/share/", format="json", data=payload
        )
        data = response.json()

        self.assertTrue(data["status"])
        self.assertEqual(data["count"], 0)

        still_shared = through_model.objects.filter(
            user_id=self.target.id,
            photo_id__in=[photo.id for photo in victim_photos],
        ).count()
        self.assertEqual(still_shared, 2)


class DeleteSelectAllOwnerScopeTest(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.attacker = create_test_user()
        self.victim = create_test_user()
        self.client.force_authenticate(user=self.attacker)

    def test_public_query_cannot_delete_other_users_trashed_photos(self):
        victim_photos = create_test_photos(
            number_of_photos=3, owner=self.victim, public=True, in_trashcan=True
        )
        own_photos = create_test_photos(
            number_of_photos=2, owner=self.attacker, public=True, in_trashcan=True
        )

        payload = {
            "select_all": True,
            "query": {"public": True},
        }
        response = self.client.delete(
            "/api/photosedit/delete/", format="json", data=payload
        )
        data = response.json()

        self.assertTrue(data["status"])
        self.assertEqual(data["count"], 2)
        self.assertEqual(data["failed_count"], 0)

        for photo in victim_photos:
            photo.refresh_from_db()
            self.assertFalse(photo.removed)
            self.assertTrue(photo.in_trashcan)
        for photo in own_photos:
            photo.refresh_from_db()
            self.assertTrue(photo.removed)
