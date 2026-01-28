"""
Edge case tests for Stack API endpoints.

Tests cover:
- Manual stack creation edge cases
- Add/remove photos from stacks
- Set primary photo
- Merge stacks
- Stack statistics
- Detection triggers
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
            format='json',
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
            format='json',
        )
        
        # Should fail - need at least 2 photos
        self.assertEqual(response.status_code, 400)

    def test_create_manual_stack_empty_photos(self):
        """Test creating manual stack with empty photo list."""
        response = self.client.post(
            "/api/stacks/manual",
            {"photo_hashes": []},
            format='json',
        )
        
        self.assertEqual(response.status_code, 400)

    def test_create_manual_stack_nonexistent_photos(self):
        """Test creating manual stack with nonexistent photo hashes."""
        response = self.client.post(
            "/api/stacks/manual",
            {"photo_hashes": ["nonexistent1", "nonexistent2"]},
            format='json',
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
            format='json',
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
            format='json',
        )
        
        # After fix: Duplicates are de-duplicated first, then we check if we have >= 2
        # Since there's only 1 unique photo, it fails with a clear message
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.data["error"], "At least 2 unique photos required to create a stack")


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
            format='json',
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
            format='json',
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
            format='json',
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
            format='json',
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
            format='json',
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
            format='json',
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
            format='json',
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
            format='json',
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
            format='json',
        )
        
        self.assertEqual(response.status_code, 200)
        
        # Should have 1 stack with all 4 photos
        stacks = PhotoStack.objects.filter(owner=self.user, stack_type=PhotoStack.StackType.MANUAL)
        self.assertEqual(stacks.count(), 1)
        self.assertEqual(stacks.first().photos.count(), 4)

    def test_merge_nonexistent_stacks(self):
        """Test merging with photos not in any stack."""
        photo1 = create_test_photo(owner=self.user)
        photo2 = create_test_photo(owner=self.user)
        
        response = self.client.post(
            "/api/stacks/merge",
            {"photo_hashes": [photo1.image_hash, photo2.image_hash]},
            format='json',
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
        self.assertEqual(response.data["by_type"][PhotoStack.StackType.BURST_SEQUENCE], 1)
        self.assertEqual(response.data["by_type"][PhotoStack.StackType.RAW_JPEG_PAIR], 1)
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
        
        response = self.client.get(f"/api/stacks?stack_type={PhotoStack.StackType.MANUAL}")
        
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
            format='json',
        )
        
        # Should return 202 Accepted (queued)
        self.assertEqual(response.status_code, 202)

    def test_trigger_detection_empty_body(self):
        """Test triggering detection with empty body (defaults)."""
        response = self.client.post("/api/stacks/detect", {}, format='json')
        
        # Should succeed with defaults
        self.assertEqual(response.status_code, 202)
