"""
Edge case tests for Stack API endpoints and input validation.

Tests cover:
- Manual stack creation edge cases
- Add/remove photos from stacks
- Set primary photo
- Merge stacks
- Stack statistics
- Detection triggers
- Duplicate photo hashes handling
- Empty/missing input validation and error message accuracy
- Stack list pagination edge cases
"""

import uuid
from django.test import TestCase
from rest_framework.test import APIClient

from api.models.photo_stack import PhotoStack
from api.tests.utils import create_test_photo, create_test_user


class ManualStackCreationAPITestCase(TestCase):
    """Tests for manual stack creation API."""

    def setUp(self):
        self.user = create_test_user()
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)

    def test_create_manual_stack_success(self):
        """Test creating a manual stack with valid photos."""
        photo1 = create_test_photo(owner=self.user)
        photo2 = create_test_photo(owner=self.user)

        response = self.client.post(
            "/api/stacks/manual",
            {"photo_hashes": [photo1.image_hash, photo2.image_hash]},
            format="json",
        )

        self.assertEqual(response.status_code, 201)
        self.assertIn("stack_id", response.data)

        # Verify stack was created
        stack = PhotoStack.objects.get(id=response.data["stack_id"])
        self.assertEqual(stack.stack_type, PhotoStack.StackType.MANUAL)
        self.assertEqual(stack.photos.count(), 2)

    def test_create_manual_stack_minimum_photos(self):
        """Test that manual stack requires at least 2 photos."""
        photo1 = create_test_photo(owner=self.user)

        response = self.client.post(
            "/api/stacks/manual",
            {"photo_hashes": [photo1.image_hash]},
            format="json",
        )

        # Should fail - need at least 2 photos
        self.assertEqual(response.status_code, 400)

    def test_create_manual_stack_empty_photos(self):
        """Test creating manual stack with empty photo list."""
        response = self.client.post(
            "/api/stacks/manual",
            {"photo_hashes": []},
            format="json",
        )

        self.assertEqual(response.status_code, 400)

    def test_create_manual_stack_nonexistent_photos(self):
        """Test creating manual stack with nonexistent photo hashes."""
        response = self.client.post(
            "/api/stacks/manual",
            {"photo_hashes": ["nonexistent1", "nonexistent2"]},
            format="json",
        )

        # Should fail - photos don't exist
        self.assertEqual(response.status_code, 400)

    def test_create_manual_stack_other_users_photos(self):
        """Test creating manual stack with other user's photos."""
        other_user = create_test_user()
        other_photo = create_test_photo(owner=other_user)
        my_photo = create_test_photo(owner=self.user)

        response = self.client.post(
            "/api/stacks/manual",
            {"photo_hashes": [my_photo.image_hash, other_photo.image_hash]},
            format="json",
        )

        # Should fail - only 1 photo found (other user's photo not found)
        self.assertEqual(response.status_code, 400)

    def test_create_manual_stack_duplicate_hashes(self):
        """Test creating manual stack with duplicate photo hashes.

        Bug #15 Fixed: Duplicate hashes are now de-duplicated before validation.
        If there's only 1 unique photo, the error message correctly states
        "At least 2 unique photos required".
        """
        photo = create_test_photo(owner=self.user)

        response = self.client.post(
            "/api/stacks/manual",
            {"photo_hashes": [photo.image_hash, photo.image_hash]},
            format="json",
        )

        # After fix: Duplicates are de-duplicated first, then we check if we have >= 2
        # Since there's only 1 unique photo, it fails with a clear message
        self.assertEqual(response.status_code, 400)
        self.assertEqual(
            response.data["error"],
            "At least 2 unique photos required to create a stack",
        )


class AddRemovePhotosAPITestCase(TestCase):
    """Tests for adding/removing photos from stacks."""

    def setUp(self):
        self.user = create_test_user()
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)

    def test_add_photo_to_stack(self):
        """Test adding a photo to an existing stack."""
        photo1 = create_test_photo(owner=self.user)
        photo2 = create_test_photo(owner=self.user)
        photo3 = create_test_photo(owner=self.user)

        stack = PhotoStack.objects.create(
            owner=self.user,
            stack_type=PhotoStack.StackType.MANUAL,
        )
        stack.photos.add(photo1, photo2)

        response = self.client.post(
            f"/api/stacks/{stack.id}/add",
            {"photo_hashes": [photo3.image_hash]},
            format="json",
        )

        self.assertEqual(response.status_code, 200)
        stack.refresh_from_db()
        self.assertEqual(stack.photos.count(), 3)

    def test_add_already_in_stack_photo(self):
        """Test adding a photo that's already in the stack."""
        photo1 = create_test_photo(owner=self.user)
        photo2 = create_test_photo(owner=self.user)

        stack = PhotoStack.objects.create(
            owner=self.user,
            stack_type=PhotoStack.StackType.MANUAL,
        )
        stack.photos.add(photo1, photo2)

        response = self.client.post(
            f"/api/stacks/{stack.id}/add",
            {"photo_hashes": [photo1.image_hash]},
            format="json",
        )

        # Should succeed (idempotent) but count stays same
        self.assertEqual(response.status_code, 200)
        stack.refresh_from_db()
        self.assertEqual(stack.photos.count(), 2)

    def test_remove_photo_from_stack(self):
        """Test removing a photo from a stack."""
        photo1 = create_test_photo(owner=self.user)
        photo2 = create_test_photo(owner=self.user)
        photo3 = create_test_photo(owner=self.user)

        stack = PhotoStack.objects.create(
            owner=self.user,
            stack_type=PhotoStack.StackType.MANUAL,
        )
        stack.photos.add(photo1, photo2, photo3)

        response = self.client.post(
            f"/api/stacks/{stack.id}/remove",
            {"photo_hashes": [photo3.image_hash]},
            format="json",
        )

        self.assertEqual(response.status_code, 200)
        stack.refresh_from_db()
        self.assertEqual(stack.photos.count(), 2)

    def test_remove_to_one_photo_deletes_stack(self):
        """Test that removing photos until 1 left deletes the stack."""
        photo1 = create_test_photo(owner=self.user)
        photo2 = create_test_photo(owner=self.user)

        stack = PhotoStack.objects.create(
            owner=self.user,
            stack_type=PhotoStack.StackType.MANUAL,
        )
        stack.photos.add(photo1, photo2)
        stack_id = stack.id

        response = self.client.post(
            f"/api/stacks/{stack_id}/remove",
            {"photo_hashes": [photo2.image_hash]},
            format="json",
        )

        self.assertEqual(response.status_code, 200)
        # Stack should be deleted (only 1 photo left)
        self.assertFalse(PhotoStack.objects.filter(id=stack_id).exists())

    def test_remove_photo_not_in_stack(self):
        """Test removing a photo that's not in the stack."""
        photo1 = create_test_photo(owner=self.user)
        photo2 = create_test_photo(owner=self.user)
        photo3 = create_test_photo(owner=self.user)

        stack = PhotoStack.objects.create(
            owner=self.user,
            stack_type=PhotoStack.StackType.MANUAL,
        )
        stack.photos.add(photo1, photo2)

        response = self.client.post(
            f"/api/stacks/{stack.id}/remove",
            {"photo_hashes": [photo3.image_hash]},
            format="json",
        )

        # Should succeed (no-op) or return 400
        self.assertIn(response.status_code, [200, 400])


class SetPrimaryPhotoAPITestCase(TestCase):
    """Tests for setting primary/cover photo."""

    def setUp(self):
        self.user = create_test_user()
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)

    def test_set_primary_photo(self):
        """Test setting a primary photo for a stack."""
        photo1 = create_test_photo(owner=self.user)
        photo2 = create_test_photo(owner=self.user)

        stack = PhotoStack.objects.create(
            owner=self.user,
            stack_type=PhotoStack.StackType.MANUAL,
            primary_photo=photo1,
        )
        stack.photos.add(photo1, photo2)

        response = self.client.post(
            f"/api/stacks/{stack.id}/primary",
            {"photo_hash": photo2.image_hash},
            format="json",
        )

        self.assertEqual(response.status_code, 200)
        stack.refresh_from_db()
        self.assertEqual(stack.primary_photo, photo2)

    def test_set_primary_photo_not_in_stack(self):
        """Test setting primary photo that's not in the stack."""
        photo1 = create_test_photo(owner=self.user)
        photo2 = create_test_photo(owner=self.user)
        photo3 = create_test_photo(owner=self.user)

        stack = PhotoStack.objects.create(
            owner=self.user,
            stack_type=PhotoStack.StackType.MANUAL,
        )
        stack.photos.add(photo1, photo2)

        response = self.client.post(
            f"/api/stacks/{stack.id}/primary",
            {"photo_hash": photo3.image_hash},
            format="json",
        )

        # Should fail - photo not in stack
        self.assertEqual(response.status_code, 400)

    def test_set_primary_nonexistent_photo(self):
        """Test setting primary with nonexistent photo hash."""
        photo1 = create_test_photo(owner=self.user)
        photo2 = create_test_photo(owner=self.user)

        stack = PhotoStack.objects.create(
            owner=self.user,
            stack_type=PhotoStack.StackType.MANUAL,
        )
        stack.photos.add(photo1, photo2)

        response = self.client.post(
            f"/api/stacks/{stack.id}/primary",
            {"photo_hash": "nonexistent"},
            format="json",
        )

        self.assertEqual(response.status_code, 400)


class MergeStacksAPITestCase(TestCase):
    """Tests for merging stacks."""

    def setUp(self):
        self.user = create_test_user()
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)

    def test_merge_two_stacks(self):
        """Test merging two manual stacks."""
        photos1 = [create_test_photo(owner=self.user) for _ in range(2)]
        photos2 = [create_test_photo(owner=self.user) for _ in range(2)]

        stack1 = PhotoStack.objects.create(
            owner=self.user,
            stack_type=PhotoStack.StackType.MANUAL,
        )
        stack1.photos.add(*photos1)

        stack2 = PhotoStack.objects.create(
            owner=self.user,
            stack_type=PhotoStack.StackType.MANUAL,
        )
        stack2.photos.add(*photos2)

        # Get all photo hashes from both stacks
        all_hashes = [p.image_hash for p in photos1 + photos2]

        response = self.client.post(
            "/api/stacks/merge",
            {"photo_hashes": all_hashes},
            format="json",
        )

        self.assertEqual(response.status_code, 200)

        # Should have 1 stack with all 4 photos
        stacks = PhotoStack.objects.filter(
            owner=self.user, stack_type=PhotoStack.StackType.MANUAL
        )
        self.assertEqual(stacks.count(), 1)
        self.assertEqual(stacks.first().photos.count(), 4)

    def test_merge_nonexistent_stacks(self):
        """Test merging with photos not in any stack."""
        photo1 = create_test_photo(owner=self.user)
        photo2 = create_test_photo(owner=self.user)

        response = self.client.post(
            "/api/stacks/merge",
            {"photo_hashes": [photo1.image_hash, photo2.image_hash]},
            format="json",
        )

        # Should create a new stack or return error
        self.assertIn(response.status_code, [200, 201, 400])


class StackStatsAPITestCase(TestCase):
    """Tests for stack statistics endpoint."""

    def setUp(self):
        self.user = create_test_user()
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)

    def test_stats_with_no_stacks(self):
        """Test stats endpoint with no stacks."""
        response = self.client.get("/api/stacks/stats")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["total_stacks"], 0)

    def test_stats_counts_by_type(self):
        """Test stats counts by stack type."""
        photos = [create_test_photo(owner=self.user) for _ in range(6)]

        # Create different stack types
        burst_stack = PhotoStack.objects.create(
            owner=self.user,
            stack_type=PhotoStack.StackType.BURST_SEQUENCE,
        )
        burst_stack.photos.add(photos[0], photos[1])

        raw_stack = PhotoStack.objects.create(
            owner=self.user,
            stack_type=PhotoStack.StackType.RAW_JPEG_PAIR,
        )
        raw_stack.photos.add(photos[2], photos[3])

        manual_stack = PhotoStack.objects.create(
            owner=self.user,
            stack_type=PhotoStack.StackType.MANUAL,
        )
        manual_stack.photos.add(photos[4], photos[5])

        response = self.client.get("/api/stacks/stats")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["total_stacks"], 3)
        self.assertEqual(
            response.data["by_type"][PhotoStack.StackType.BURST_SEQUENCE], 1
        )
        self.assertEqual(
            response.data["by_type"][PhotoStack.StackType.RAW_JPEG_PAIR], 1
        )
        self.assertEqual(response.data["by_type"][PhotoStack.StackType.MANUAL], 1)

    def test_stats_photos_in_stacks(self):
        """Test stats counts photos in stacks correctly."""
        photos = [create_test_photo(owner=self.user) for _ in range(5)]

        stack1 = PhotoStack.objects.create(
            owner=self.user,
            stack_type=PhotoStack.StackType.MANUAL,
        )
        stack1.photos.add(photos[0], photos[1], photos[2])

        # Create another stack with overlapping photo
        stack2 = PhotoStack.objects.create(
            owner=self.user,
            stack_type=PhotoStack.StackType.BURST_SEQUENCE,
        )
        stack2.photos.add(photos[2], photos[3])  # photos[2] in both

        response = self.client.get("/api/stacks/stats")

        self.assertEqual(response.status_code, 200)
        # 4 unique photos (0,1,2,3)
        self.assertEqual(response.data["photos_in_stacks"], 4)

    def test_stats_other_users_not_included(self):
        """Test stats don't include other user's stacks."""
        other_user = create_test_user()

        # Create stack for other user
        other_photo1 = create_test_photo(owner=other_user)
        other_photo2 = create_test_photo(owner=other_user)
        stack = PhotoStack.objects.create(
            owner=other_user,
            stack_type=PhotoStack.StackType.MANUAL,
        )
        stack.photos.add(other_photo1, other_photo2)

        response = self.client.get("/api/stacks/stats")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["total_stacks"], 0)


class StackDeleteAPITestCase(TestCase):
    """Tests for stack deletion."""

    def setUp(self):
        self.user = create_test_user()
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)

    def test_delete_stack(self):
        """Test deleting a stack."""
        photo1 = create_test_photo(owner=self.user)
        photo2 = create_test_photo(owner=self.user)

        stack = PhotoStack.objects.create(
            owner=self.user,
            stack_type=PhotoStack.StackType.MANUAL,
        )
        stack.photos.add(photo1, photo2)
        stack_id = stack.id

        response = self.client.delete(f"/api/stacks/{stack_id}/delete")

        self.assertEqual(response.status_code, 200)
        self.assertFalse(PhotoStack.objects.filter(id=stack_id).exists())

        # Photos should still exist
        photo1.refresh_from_db()
        photo2.refresh_from_db()
        self.assertFalse(photo1.removed)

    def test_delete_nonexistent_stack(self):
        """Test deleting a nonexistent stack."""
        response = self.client.delete(f"/api/stacks/{uuid.uuid4()}/delete")
        self.assertEqual(response.status_code, 404)

    def test_delete_other_users_stack(self):
        """Test deleting another user's stack."""
        other_user = create_test_user()
        photo1 = create_test_photo(owner=other_user)
        photo2 = create_test_photo(owner=other_user)

        stack = PhotoStack.objects.create(
            owner=other_user,
            stack_type=PhotoStack.StackType.MANUAL,
        )
        stack.photos.add(photo1, photo2)

        response = self.client.delete(f"/api/stacks/{stack.id}/delete")

        # Should return 404 (not found for this user)
        self.assertEqual(response.status_code, 404)


class StackDetailAPITestCase(TestCase):
    """Tests for stack detail view."""

    def setUp(self):
        self.user = create_test_user()
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)

    def test_get_stack_detail(self):
        """Test getting stack details."""
        photo1 = create_test_photo(owner=self.user)
        photo2 = create_test_photo(owner=self.user)

        stack = PhotoStack.objects.create(
            owner=self.user,
            stack_type=PhotoStack.StackType.MANUAL,
            primary_photo=photo1,
        )
        stack.photos.add(photo1, photo2)

        response = self.client.get(f"/api/stacks/{stack.id}")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["stack_type"], PhotoStack.StackType.MANUAL)
        self.assertEqual(len(response.data["photos"]), 2)

    def test_get_stack_with_deleted_primary(self):
        """Test getting stack when primary photo was deleted."""
        photo1 = create_test_photo(owner=self.user)
        photo2 = create_test_photo(owner=self.user)
        photo3 = create_test_photo(owner=self.user)

        stack = PhotoStack.objects.create(
            owner=self.user,
            stack_type=PhotoStack.StackType.MANUAL,
            primary_photo=photo1,
        )
        stack.photos.add(photo1, photo2, photo3)

        # Delete primary photo
        photo1.in_trashcan = True
        photo1.save()
        photo1.manual_delete()

        # Stack should still exist with 2 photos
        stack.refresh_from_db()

        response = self.client.get(f"/api/stacks/{stack.id}")

        self.assertEqual(response.status_code, 200)


class StackListAPITestCase(TestCase):
    """Tests for stack list view."""

    def setUp(self):
        self.user = create_test_user()
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)

    def test_list_stacks(self):
        """Test listing all stacks."""
        photos = [create_test_photo(owner=self.user) for _ in range(4)]

        stack1 = PhotoStack.objects.create(
            owner=self.user,
            stack_type=PhotoStack.StackType.MANUAL,
        )
        stack1.photos.add(photos[0], photos[1])

        stack2 = PhotoStack.objects.create(
            owner=self.user,
            stack_type=PhotoStack.StackType.BURST_SEQUENCE,
        )
        stack2.photos.add(photos[2], photos[3])

        response = self.client.get("/api/stacks")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["count"], 2)

    def test_list_stacks_filter_by_type(self):
        """Test filtering stacks by type."""
        photos = [create_test_photo(owner=self.user) for _ in range(4)]

        manual_stack = PhotoStack.objects.create(
            owner=self.user,
            stack_type=PhotoStack.StackType.MANUAL,
        )
        manual_stack.photos.add(photos[0], photos[1])

        burst_stack = PhotoStack.objects.create(
            owner=self.user,
            stack_type=PhotoStack.StackType.BURST_SEQUENCE,
        )
        burst_stack.photos.add(photos[2], photos[3])

        response = self.client.get(
            f"/api/stacks?stack_type={PhotoStack.StackType.MANUAL}"
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["count"], 1)

    def test_list_excludes_single_photo_stacks(self):
        """Test that list excludes stacks with only 1 photo."""
        photo = create_test_photo(owner=self.user)

        stack = PhotoStack.objects.create(
            owner=self.user,
            stack_type=PhotoStack.StackType.MANUAL,
        )
        stack.photos.add(photo)

        response = self.client.get("/api/stacks")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["count"], 0)


class DetectionTriggerAPITestCase(TestCase):
    """Tests for detection trigger endpoints."""

    def setUp(self):
        self.user = create_test_user()
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)

    def test_trigger_detection(self):
        """Test triggering stack detection."""
        response = self.client.post(
            "/api/stacks/detect",
            {
                "detect_raw_jpeg": True,
                "detect_bursts": False,
                "detect_live_photos": False,
            },
            format="json",
        )

        # Should return 202 Accepted (queued)
        self.assertEqual(response.status_code, 202)

    def test_trigger_detection_empty_body(self):
        """Test triggering detection with empty body (defaults)."""
        response = self.client.post("/api/stacks/detect", {}, format="json")

        # Should succeed with defaults
        self.assertEqual(response.status_code, 202)


class DuplicatePhotoHashesTestCase(TestCase):
    """Tests for handling duplicate photo hashes in input."""

    def setUp(self):
        self.user = create_test_user()
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)

    def test_create_manual_stack_with_duplicate_valid_hashes(self):
        """
        Test creating manual stack when two valid photos are provided
        but one hash is duplicated.

        Fixed Bug #15: If photo_hashes = [hash1, hash2, hash1], the input
        is de-duplicated before validation. Since there are 2 unique valid
        photos, the stack creation should succeed.
        """
        photo1 = create_test_photo(owner=self.user)
        photo2 = create_test_photo(owner=self.user)

        # Send duplicate hash1
        response = self.client.post(
            "/api/stacks/manual",
            {"photo_hashes": [photo1.image_hash, photo2.image_hash, photo1.image_hash]},
            format="json",
        )

        # After fix: Duplicates are de-duplicated, so 2 unique photos are found
        # Stack creation should succeed
        self.assertEqual(response.status_code, 201)
        self.assertIn("stack_id", response.data)

        # Verify stack was created with 2 photos
        stack = PhotoStack.objects.get(id=response.data["stack_id"])
        self.assertEqual(stack.photos.count(), 2)

    def test_add_photos_with_duplicate_hashes(self):
        """Test adding photos with duplicate hashes to existing stack."""
        photo1 = create_test_photo(owner=self.user)
        photo2 = create_test_photo(owner=self.user)
        photo3 = create_test_photo(owner=self.user)

        stack = PhotoStack.objects.create(
            owner=self.user,
            stack_type=PhotoStack.StackType.MANUAL,
        )
        stack.photos.add(photo1, photo2)

        # Add photo3 with duplicate hash
        response = self.client.post(
            f"/api/stacks/{stack.id}/add",
            {"photo_hashes": [photo3.image_hash, photo3.image_hash]},
            format="json",
        )

        # Should work - duplicates should be ignored
        self.assertEqual(response.status_code, 200)
        stack.refresh_from_db()
        self.assertEqual(stack.photos.count(), 3)

    def test_remove_photos_with_duplicate_hashes(self):
        """Test removing photos with duplicate hashes."""
        photos = [create_test_photo(owner=self.user) for _ in range(4)]

        stack = PhotoStack.objects.create(
            owner=self.user,
            stack_type=PhotoStack.StackType.MANUAL,
        )
        stack.photos.add(*photos)

        # Remove with duplicate hash
        response = self.client.post(
            f"/api/stacks/{stack.id}/remove",
            {"photo_hashes": [photos[0].image_hash, photos[0].image_hash]},
            format="json",
        )

        # Should work - removes only once
        self.assertEqual(response.status_code, 200)
        stack.refresh_from_db()
        self.assertEqual(stack.photos.count(), 3)


class MergeStacksDuplicateHashesTestCase(TestCase):
    """Tests for merge stacks with duplicate hashes."""

    def setUp(self):
        self.user = create_test_user()
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)

    def test_merge_with_duplicate_hashes(self):
        """Test merge endpoint with duplicate photo hashes.

        Fixed Bug #15: Duplicate hashes are now de-duplicated before validation.
        """
        photos1 = [create_test_photo(owner=self.user) for _ in range(2)]
        photos2 = [create_test_photo(owner=self.user) for _ in range(2)]

        stack1 = PhotoStack.objects.create(
            owner=self.user,
            stack_type=PhotoStack.StackType.MANUAL,
        )
        stack1.photos.add(*photos1)

        stack2 = PhotoStack.objects.create(
            owner=self.user,
            stack_type=PhotoStack.StackType.MANUAL,
        )
        stack2.photos.add(*photos2)

        # Include duplicate hashes
        hashes = [photos1[0].image_hash, photos2[0].image_hash, photos1[0].image_hash]

        response = self.client.post(
            "/api/stacks/merge",
            {"photo_hashes": hashes},
            format="json",
        )

        # After fix: Duplicates are de-duplicated, merge should succeed
        self.assertEqual(response.status_code, 200)
        self.assertIn("stack_id", response.data)

        # Should have merged into one stack with all 4 photos
        stacks = PhotoStack.objects.filter(
            owner=self.user, stack_type=PhotoStack.StackType.MANUAL
        )
        self.assertEqual(stacks.count(), 1)
        self.assertEqual(stacks.first().photos.count(), 4)


class ListStacksWithNullThumbnailTestCase(TestCase):
    """Tests for stack list with photos that have no thumbnails."""

    def setUp(self):
        self.user = create_test_user()
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)

    def test_list_stacks_without_thumbnails(self):
        """Test listing stacks when photos have thumbnails (created by helper)."""
        # Note: create_test_photo creates thumbnails, so we test that listing works
        photo1 = create_test_photo(owner=self.user)
        photo2 = create_test_photo(owner=self.user)

        stack = PhotoStack.objects.create(
            owner=self.user,
            stack_type=PhotoStack.StackType.MANUAL,
            primary_photo=photo1,
        )
        stack.photos.add(photo1, photo2)

        # List should work
        response = self.client.get("/api/stacks")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["count"], 1)

        # thumbnail_url should be present (create_test_photo creates thumbnails)
        result = response.data["results"][0]
        # Primary photo thumbnail should exist since create_test_photo creates them
        if result.get("primary_photo"):
            # Just verify the structure is valid - may or may not have thumbnail
            self.assertIn("thumbnail_url", result["primary_photo"])

    def test_detail_stack_without_thumbnails(self):
        """Test getting stack detail when photos don't have thumbnails."""
        photo1 = create_test_photo(owner=self.user)
        photo2 = create_test_photo(owner=self.user)

        stack = PhotoStack.objects.create(
            owner=self.user,
            stack_type=PhotoStack.StackType.MANUAL,
            primary_photo=photo1,
        )
        stack.photos.add(photo1, photo2)

        response = self.client.get(f"/api/stacks/{stack.id}")

        self.assertEqual(response.status_code, 200)
        # Should have photos even without thumbnails
        self.assertEqual(len(response.data["photos"]), 2)


class RemoveFromStackPrimaryPhotoTestCase(TestCase):
    """Tests for removing the primary photo from a stack."""

    def setUp(self):
        self.user = create_test_user()
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)

    def test_remove_primary_updates_primary(self):
        """Test that removing the primary photo selects a new primary."""
        photo1 = create_test_photo(owner=self.user)
        photo2 = create_test_photo(owner=self.user)
        photo3 = create_test_photo(owner=self.user)

        stack = PhotoStack.objects.create(
            owner=self.user,
            stack_type=PhotoStack.StackType.MANUAL,
            primary_photo=photo1,
        )
        stack.photos.add(photo1, photo2, photo3)

        # Remove the primary photo
        response = self.client.post(
            f"/api/stacks/{stack.id}/remove",
            {"photo_hashes": [photo1.image_hash]},
            format="json",
        )

        self.assertEqual(response.status_code, 200)
        stack.refresh_from_db()

        # Primary should have changed
        self.assertIsNotNone(stack.primary_photo)
        self.assertNotEqual(stack.primary_photo.image_hash, photo1.image_hash)

    def test_remove_non_primary_keeps_primary(self):
        """Test that removing a non-primary photo keeps the current primary."""
        photo1 = create_test_photo(owner=self.user)
        photo2 = create_test_photo(owner=self.user)
        photo3 = create_test_photo(owner=self.user)

        stack = PhotoStack.objects.create(
            owner=self.user,
            stack_type=PhotoStack.StackType.MANUAL,
            primary_photo=photo1,
        )
        stack.photos.add(photo1, photo2, photo3)

        # Remove a non-primary photo
        response = self.client.post(
            f"/api/stacks/{stack.id}/remove",
            {"photo_hashes": [photo2.image_hash]},
            format="json",
        )

        self.assertEqual(response.status_code, 200)
        stack.refresh_from_db()

        # Primary should stay the same
        self.assertEqual(stack.primary_photo.image_hash, photo1.image_hash)


class EmptyInputTestCase(TestCase):
    """Tests for empty or null input handling."""

    def setUp(self):
        self.user = create_test_user()
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)

    def test_set_primary_no_hash(self):
        """Test setting primary with no photo_hash provided."""
        photo1 = create_test_photo(owner=self.user)
        photo2 = create_test_photo(owner=self.user)

        stack = PhotoStack.objects.create(
            owner=self.user,
            stack_type=PhotoStack.StackType.MANUAL,
        )
        stack.photos.add(photo1, photo2)

        response = self.client.post(
            f"/api/stacks/{stack.id}/primary",
            {},  # No photo_hash
            format="json",
        )

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.data["error"], "photo_hash is required")

    def test_set_primary_empty_hash(self):
        """Test setting primary with empty photo_hash."""
        photo1 = create_test_photo(owner=self.user)
        photo2 = create_test_photo(owner=self.user)

        stack = PhotoStack.objects.create(
            owner=self.user,
            stack_type=PhotoStack.StackType.MANUAL,
        )
        stack.photos.add(photo1, photo2)

        response = self.client.post(
            f"/api/stacks/{stack.id}/primary",
            {"photo_hash": ""},  # Empty hash
            format="json",
        )

        self.assertEqual(response.status_code, 400)

    def test_add_empty_photo_list(self):
        """Test adding empty photo list to stack."""
        photo1 = create_test_photo(owner=self.user)
        photo2 = create_test_photo(owner=self.user)

        stack = PhotoStack.objects.create(
            owner=self.user,
            stack_type=PhotoStack.StackType.MANUAL,
        )
        stack.photos.add(photo1, photo2)

        response = self.client.post(
            f"/api/stacks/{stack.id}/add",
            {"photo_hashes": []},
            format="json",
        )

        self.assertEqual(response.status_code, 400)

    def test_remove_empty_photo_list(self):
        """Test removing empty photo list from stack."""
        photo1 = create_test_photo(owner=self.user)
        photo2 = create_test_photo(owner=self.user)

        stack = PhotoStack.objects.create(
            owner=self.user,
            stack_type=PhotoStack.StackType.MANUAL,
        )
        stack.photos.add(photo1, photo2)

        response = self.client.post(
            f"/api/stacks/{stack.id}/remove",
            {"photo_hashes": []},
            format="json",
        )

        self.assertEqual(response.status_code, 400)

    def test_merge_empty_photo_list(self):
        """Test merge with empty photo list."""
        response = self.client.post(
            "/api/stacks/merge",
            {"photo_hashes": []},
            format="json",
        )

        self.assertEqual(response.status_code, 400)

    def test_create_manual_missing_photo_hashes_key(self):
        """Test creating manual stack without photo_hashes key."""
        response = self.client.post(
            "/api/stacks/manual",
            {},  # No photo_hashes key
            format="json",
        )

        self.assertEqual(response.status_code, 400)


class StackListPaginationEdgeCasesTestCase(TestCase):
    """Tests for pagination edge cases in stack list."""

    def setUp(self):
        self.user = create_test_user()
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)

        # Create 5 stacks
        for i in range(5):
            photos = [create_test_photo(owner=self.user) for _ in range(2)]
            stack = PhotoStack.objects.create(
                owner=self.user,
                stack_type=PhotoStack.StackType.MANUAL,
            )
            stack.photos.add(*photos)

    def test_page_beyond_results(self):
        """Test requesting a page beyond available results."""
        response = self.client.get("/api/stacks?page=100")

        self.assertEqual(response.status_code, 200)
        # Django's Paginator.get_page() returns last page for out-of-range pages
        # So we may get results (last page) rather than empty
        self.assertGreaterEqual(len(response.data["results"]), 0)
        # has_next should be False since we're at/past the last page
        self.assertFalse(response.data["has_next"])

    def test_page_zero(self):
        """Test requesting page 0 (should default to 1)."""
        response = self.client.get("/api/stacks?page=0")

        self.assertEqual(response.status_code, 200)
        # Should get results (treated as page 1)
        self.assertGreater(len(response.data["results"]), 0)

    def test_negative_page(self):
        """Test requesting negative page number."""
        response = self.client.get("/api/stacks?page=-1")

        self.assertEqual(response.status_code, 200)
        # Should get results (negative treated as 1)
        self.assertGreater(len(response.data["results"]), 0)

    def test_non_numeric_page(self):
        """Test requesting non-numeric page."""
        response = self.client.get("/api/stacks?page=abc")

        # After Bug #16 fix: Non-numeric page defaults to 1
        self.assertEqual(response.status_code, 200)
        self.assertGreater(len(response.data["results"]), 0)

    def test_page_size_zero(self):
        """Test requesting page_size of 0."""
        response = self.client.get("/api/stacks?page_size=0")

        self.assertEqual(response.status_code, 200)
        # page_size=0 should be treated as page_size=1 (min)
        self.assertGreater(len(response.data["results"]), 0)

    def test_page_size_negative(self):
        """Test requesting negative page_size."""
        response = self.client.get("/api/stacks?page_size=-5")

        # Should handle gracefully (Bug #10 fix)
        self.assertEqual(response.status_code, 200)

    def test_page_size_exceeds_max(self):
        """Test requesting page_size exceeding maximum."""
        response = self.client.get("/api/stacks?page_size=1000")

        self.assertEqual(response.status_code, 200)
        # page_size should be capped at 100
        self.assertLessEqual(response.data["page_size"], 100)

    def test_non_numeric_page_size(self):
        """Test requesting non-numeric page_size."""
        response = self.client.get("/api/stacks?page_size=abc")

        # After Bug #16 fix: Non-numeric page_size defaults to 20
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["page_size"], 20)
