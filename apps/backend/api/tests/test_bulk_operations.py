"""
Tests for server-side bulk operations (select_all mode).

These tests verify that bulk operations work correctly when using
query-based selection instead of individual image hashes.
"""

import logging

from django.test import TestCase
from rest_framework.test import APIClient

from api.models import Photo
from api.tests.utils import create_test_photos, create_test_user
from api.views.photo_filters import build_photo_queryset

logger = logging.getLogger(__name__)


class BuildPhotoQuerysetTest(TestCase):
    """Tests for the build_photo_queryset utility function."""

    def setUp(self):
        self.user1 = create_test_user()
        self.user2 = create_test_user()

    def test_filters_by_owner(self):
        """Test that photos are filtered by owner."""
        create_test_photos(number_of_photos=3, owner=self.user1)
        create_test_photos(number_of_photos=2, owner=self.user2)

        qs = build_photo_queryset(self.user1, {})
        self.assertEqual(qs.count(), 3)

    def test_filters_by_video(self):
        """Test filtering for videos only."""
        create_test_photos(number_of_photos=2, owner=self.user1, video=False)
        create_test_photos(number_of_photos=3, owner=self.user1, video=True)

        qs = build_photo_queryset(self.user1, {"video": True})
        self.assertEqual(qs.count(), 3)

    def test_filters_by_photo(self):
        """Test filtering for photos only (non-videos)."""
        create_test_photos(number_of_photos=2, owner=self.user1, video=False)
        create_test_photos(number_of_photos=3, owner=self.user1, video=True)

        qs = build_photo_queryset(self.user1, {"photo": True})
        self.assertEqual(qs.count(), 2)

    def test_filters_hidden(self):
        """Test filtering by hidden status."""
        create_test_photos(number_of_photos=2, owner=self.user1, hidden=False)
        create_test_photos(number_of_photos=3, owner=self.user1, hidden=True)

        # By default, hidden=False is applied
        qs = build_photo_queryset(self.user1, {})
        self.assertEqual(qs.count(), 2)

        # Explicit hidden=True
        qs = build_photo_queryset(self.user1, {"hidden": True})
        self.assertEqual(qs.count(), 3)

    def test_filters_in_trashcan(self):
        """Test filtering by trashcan status."""
        create_test_photos(number_of_photos=2, owner=self.user1, in_trashcan=False)
        create_test_photos(number_of_photos=3, owner=self.user1, in_trashcan=True)

        # By default, in_trashcan=False is applied
        qs = build_photo_queryset(self.user1, {})
        self.assertEqual(qs.count(), 2)

        # Explicit in_trashcan=True
        qs = build_photo_queryset(self.user1, {"in_trashcan": True})
        self.assertEqual(qs.count(), 3)


class BulkSetPhotosPublicTest(TestCase):
    """Tests for bulk SetPhotosPublic with select_all mode."""

    def setUp(self):
        self.client = APIClient()
        self.user1 = create_test_user()
        self.user2 = create_test_user()
        self.client.force_authenticate(user=self.user1)

    def test_select_all_make_public(self):
        """Test making all photos public via select_all."""
        photos = create_test_photos(number_of_photos=5, owner=self.user1, public=False)

        payload = {
            "select_all": True,
            "query": {},
            "val_public": True,
        }
        response = self.client.post(
            "/api/photosedit/makepublic/", format="json", data=payload
        )
        data = response.json()

        self.assertTrue(data["status"])
        self.assertEqual(data["count"], 5)

        # Verify all photos are now public
        for photo in photos:
            photo.refresh_from_db()
            self.assertTrue(photo.public)

    def test_select_all_make_private(self):
        """Test making all photos private via select_all."""
        photos = create_test_photos(number_of_photos=3, owner=self.user1, public=True)

        payload = {
            "select_all": True,
            "query": {},
            "val_public": False,
        }
        response = self.client.post(
            "/api/photosedit/makepublic/", format="json", data=payload
        )
        data = response.json()

        self.assertTrue(data["status"])
        self.assertEqual(data["count"], 3)

        # Verify all photos are now private
        for photo in photos:
            photo.refresh_from_db()
            self.assertFalse(photo.public)

    def test_select_all_with_exclusions(self):
        """Test select_all with some photos excluded."""
        photos = create_test_photos(number_of_photos=5, owner=self.user1, public=False)
        excluded_hashes = [photos[0].image_hash, photos[1].image_hash]

        payload = {
            "select_all": True,
            "query": {},
            "excluded_hashes": excluded_hashes,
            "val_public": True,
        }
        response = self.client.post(
            "/api/photosedit/makepublic/", format="json", data=payload
        )
        data = response.json()

        self.assertTrue(data["status"])
        self.assertEqual(data["count"], 3)  # 5 - 2 excluded

        # Verify excluded photos are still private
        photos[0].refresh_from_db()
        photos[1].refresh_from_db()
        self.assertFalse(photos[0].public)
        self.assertFalse(photos[1].public)

        # Verify other photos are public
        for photo in photos[2:]:
            photo.refresh_from_db()
            self.assertTrue(photo.public)

    def test_select_all_only_affects_own_photos(self):
        """Test that select_all only affects the user's own photos."""
        create_test_photos(number_of_photos=3, owner=self.user1, public=False)
        other_photos = create_test_photos(
            number_of_photos=2, owner=self.user2, public=False
        )

        payload = {
            "select_all": True,
            "query": {},
            "val_public": True,
        }
        response = self.client.post(
            "/api/photosedit/makepublic/", format="json", data=payload
        )
        data = response.json()

        self.assertTrue(data["status"])
        self.assertEqual(data["count"], 3)

        # Verify other user's photos are untouched
        for photo in other_photos:
            photo.refresh_from_db()
            self.assertFalse(photo.public)


class BulkSetPhotosHiddenTest(TestCase):
    """Tests for bulk SetPhotosHidden with select_all mode."""

    def setUp(self):
        self.client = APIClient()
        self.user1 = create_test_user()
        self.client.force_authenticate(user=self.user1)

    def test_select_all_hide_photos(self):
        """Test hiding all photos via select_all."""
        photos = create_test_photos(number_of_photos=4, owner=self.user1, hidden=False)

        payload = {
            "select_all": True,
            "query": {},
            "hidden": True,
        }
        response = self.client.post(
            "/api/photosedit/hide/", format="json", data=payload
        )
        data = response.json()

        self.assertTrue(data["status"])
        self.assertEqual(data["count"], 4)

        # Verify all photos are now hidden
        for photo in photos:
            photo.refresh_from_db()
            self.assertTrue(photo.hidden)

    def test_select_all_unhide_photos(self):
        """Test unhiding all photos via select_all."""
        photos = create_test_photos(number_of_photos=3, owner=self.user1, hidden=True)

        payload = {
            "select_all": True,
            "query": {"hidden": True},  # Need to query hidden photos
            "hidden": False,
        }
        response = self.client.post(
            "/api/photosedit/hide/", format="json", data=payload
        )
        data = response.json()

        self.assertTrue(data["status"])
        self.assertEqual(data["count"], 3)

        # Verify all photos are now unhidden
        for photo in photos:
            photo.refresh_from_db()
            self.assertFalse(photo.hidden)


class BulkSetPhotosFavoriteTest(TestCase):
    """Tests for bulk SetPhotosFavorite with select_all mode."""

    def setUp(self):
        self.client = APIClient()
        self.user1 = create_test_user()
        self.client.force_authenticate(user=self.user1)

    def test_select_all_favorite_photos(self):
        """Test favoriting all photos via select_all."""
        photos = create_test_photos(number_of_photos=4, owner=self.user1, rating=0)

        payload = {
            "select_all": True,
            "query": {},
            "favorite": True,
        }
        response = self.client.post(
            "/api/photosedit/favorite/", format="json", data=payload
        )
        data = response.json()

        self.assertTrue(data["status"])
        self.assertEqual(data["count"], 4)

        # Verify all photos are now favorited
        for photo in photos:
            photo.refresh_from_db()
            self.assertGreaterEqual(photo.rating, self.user1.favorite_min_rating)

    def test_select_all_unfavorite_photos(self):
        """Test unfavoriting all photos via select_all."""
        photos = create_test_photos(
            number_of_photos=3,
            owner=self.user1,
            rating=self.user1.favorite_min_rating,
        )

        payload = {
            "select_all": True,
            "query": {"favorite": True},  # Need to query favorite photos
            "favorite": False,
        }
        response = self.client.post(
            "/api/photosedit/favorite/", format="json", data=payload
        )
        data = response.json()

        self.assertTrue(data["status"])
        self.assertEqual(data["count"], 3)

        # Verify all photos are now unfavorited
        for photo in photos:
            photo.refresh_from_db()
            self.assertEqual(photo.rating, 0)


class BulkSetPhotosDeletedTest(TestCase):
    """Tests for bulk SetPhotosDeleted with select_all mode."""

    def setUp(self):
        self.client = APIClient()
        self.user1 = create_test_user()
        self.client.force_authenticate(user=self.user1)

    def test_select_all_move_to_trash(self):
        """Test moving all photos to trash via select_all."""
        photos = create_test_photos(
            number_of_photos=4, owner=self.user1, in_trashcan=False
        )

        payload = {
            "select_all": True,
            "query": {},
            "deleted": True,
        }
        response = self.client.post(
            "/api/photosedit/setdeleted/", format="json", data=payload
        )
        data = response.json()

        self.assertTrue(data["status"])
        self.assertEqual(data["count"], 4)

        # Verify all photos are now in trashcan
        for photo in photos:
            photo.refresh_from_db()
            self.assertTrue(photo.in_trashcan)

    def test_select_all_restore_from_trash(self):
        """Test restoring all photos from trash via select_all."""
        photos = create_test_photos(
            number_of_photos=3, owner=self.user1, in_trashcan=True
        )

        payload = {
            "select_all": True,
            "query": {"in_trashcan": True},  # Need to query trashed photos
            "deleted": False,
        }
        response = self.client.post(
            "/api/photosedit/setdeleted/", format="json", data=payload
        )
        data = response.json()

        self.assertTrue(data["status"])
        self.assertEqual(data["count"], 3)

        # Verify all photos are now restored
        for photo in photos:
            photo.refresh_from_db()
            self.assertFalse(photo.in_trashcan)


class BulkSharePhotosTest(TestCase):
    """Tests for bulk SetPhotosShared with select_all mode."""

    def setUp(self):
        self.client = APIClient()
        self.user1 = create_test_user()
        self.user2 = create_test_user()
        self.client.force_authenticate(user=self.user1)

    def test_select_all_share_photos(self):
        """Test sharing all photos via select_all."""
        photos = create_test_photos(number_of_photos=5, owner=self.user1)

        payload = {
            "select_all": True,
            "query": {},
            "val_shared": True,
            "target_user_id": self.user2.id,
        }
        response = self.client.post(
            "/api/photosedit/share/", format="json", data=payload
        )
        data = response.json()

        self.assertTrue(data["status"])
        self.assertEqual(data["count"], 5)

        # Verify all photos are shared with user2
        through_model = Photo.shared_to.through
        shared_count = through_model.objects.filter(user_id=self.user2.id).count()
        self.assertEqual(shared_count, 5)

    def test_select_all_unshare_photos(self):
        """Test unsharing all photos via select_all."""
        photos = create_test_photos(number_of_photos=3, owner=self.user1)

        # First share the photos
        through_model = Photo.shared_to.through
        through_model.objects.bulk_create(
            [
                through_model(user_id=self.user2.id, photo_id=p.image_hash)
                for p in photos
            ]
        )

        payload = {
            "select_all": True,
            "query": {},
            "val_shared": False,
            "target_user_id": self.user2.id,
        }
        response = self.client.post(
            "/api/photosedit/share/", format="json", data=payload
        )
        data = response.json()

        self.assertTrue(data["status"])
        self.assertEqual(data["count"], 3)

        # Verify no photos are shared with user2
        shared_count = through_model.objects.filter(user_id=self.user2.id).count()
        self.assertEqual(shared_count, 0)

    def test_select_all_share_with_exclusions(self):
        """Test sharing with exclusions via select_all."""
        photos = create_test_photos(number_of_photos=5, owner=self.user1)
        excluded_hashes = [photos[0].image_hash]

        payload = {
            "select_all": True,
            "query": {},
            "excluded_hashes": excluded_hashes,
            "val_shared": True,
            "target_user_id": self.user2.id,
        }
        response = self.client.post(
            "/api/photosedit/share/", format="json", data=payload
        )
        data = response.json()

        self.assertTrue(data["status"])
        self.assertEqual(data["count"], 4)  # 5 - 1 excluded

        # Verify excluded photo is not shared
        through_model = Photo.shared_to.through
        excluded_shared = through_model.objects.filter(
            user_id=self.user2.id, photo_id=photos[0].image_hash
        ).exists()
        self.assertFalse(excluded_shared)

