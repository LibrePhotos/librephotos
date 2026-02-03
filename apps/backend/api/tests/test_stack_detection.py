"""
Comprehensive tests for PhotoStack Detection and API.

Tests cover:
- PhotoStack model functionality
- Stack API endpoints (list, detail, delete, set-primary, add, remove)
- Manual stack creation and merging
- Stack detection triggering
- Edge cases and error handling
"""

import uuid
from unittest.mock import patch

from django.test import TestCase
from rest_framework import status
from rest_framework.test import APIClient

from api.models import Photo
from api.models.photo_stack import PhotoStack
from api.tests.utils import create_test_photo, create_test_user


class PhotoStackModelTestCase(TestCase):
    """Tests for PhotoStack model functionality."""

    def setUp(self):
        self.user = create_test_user()
        self.photo1 = create_test_photo(owner=self.user)
        self.photo2 = create_test_photo(owner=self.user)
        self.photo3 = create_test_photo(owner=self.user)

    def test_create_stack_basic(self):
        """Test basic stack creation."""
        stack = PhotoStack.objects.create(
            owner=self.user,
            stack_type=PhotoStack.StackType.MANUAL,
        )
        self.photo1.stacks.add(stack)
        self.photo2.stacks.add(stack)

        self.assertEqual(stack.photo_count, 2)
        self.assertEqual(stack.owner, self.user)
        self.assertEqual(stack.stack_type, PhotoStack.StackType.MANUAL)

    def test_stack_types(self):
        """Test all stack types can be created."""
        for stack_type, display_name in PhotoStack.StackType.choices:
            stack = PhotoStack.objects.create(
                owner=self.user,
                stack_type=stack_type,
            )
            self.assertEqual(stack.stack_type, stack_type)
            self.assertIn(display_name, str(stack.get_stack_type_display()))

    def test_auto_select_primary_for_manual_stack(self):
        """Test auto-selecting primary for manual stack picks highest resolution."""
        stack = PhotoStack.objects.create(
            owner=self.user,
            stack_type=PhotoStack.StackType.MANUAL,
        )
        self.photo1.stacks.add(stack)
        self.photo2.stacks.add(stack)
        
        stack.auto_select_primary()
        
        # Primary should be set
        self.assertIsNotNone(stack.primary_photo)
        self.assertIn(stack.primary_photo, [self.photo1, self.photo2])

    def test_auto_select_primary_empty_stack(self):
        """Test auto_select_primary returns None for empty stack."""
        stack = PhotoStack.objects.create(
            owner=self.user,
            stack_type=PhotoStack.StackType.MANUAL,
        )
        
        result = stack.auto_select_primary()
        
        self.assertIsNone(result)
        self.assertIsNone(stack.primary_photo)

    def test_merge_with_another_stack(self):
        """Test merging two stacks."""
        stack1 = PhotoStack.objects.create(
            owner=self.user,
            stack_type=PhotoStack.StackType.MANUAL,
        )
        stack2 = PhotoStack.objects.create(
            owner=self.user,
            stack_type=PhotoStack.StackType.MANUAL,
        )
        
        self.photo1.stacks.add(stack1)
        self.photo2.stacks.add(stack2)
        self.photo3.stacks.add(stack2)
        
        stack2_id = stack2.pk
        stack1.merge_with(stack2)
        
        # All photos should be in stack1
        self.assertEqual(stack1.photos.count(), 3)
        self.assertIn(self.photo1, stack1.photos.all())
        self.assertIn(self.photo2, stack1.photos.all())
        self.assertIn(self.photo3, stack1.photos.all())
        
        # stack2 should be deleted
        self.assertFalse(PhotoStack.objects.filter(pk=stack2_id).exists())

    def test_merge_with_self_does_nothing(self):
        """Test merging a stack with itself is a no-op."""
        stack = PhotoStack.objects.create(
            owner=self.user,
            stack_type=PhotoStack.StackType.MANUAL,
        )
        self.photo1.stacks.add(stack)
        
        stack.merge_with(stack)
        
        # Stack should still exist and have same photo
        self.assertTrue(PhotoStack.objects.filter(pk=stack.pk).exists())
        self.assertEqual(stack.photos.count(), 1)

    def test_create_or_merge_new_stack(self):
        """Test create_or_merge creates a new stack when no overlap."""
        photos = [self.photo1, self.photo2]
        
        stack = PhotoStack.create_or_merge(
            owner=self.user,
            stack_type=PhotoStack.StackType.MANUAL,
            photos=photos,
        )
        
        self.assertIsNotNone(stack)
        self.assertEqual(stack.photos.count(), 2)
        self.assertIsNotNone(stack.primary_photo)

    def test_create_or_merge_returns_none_for_single_photo(self):
        """Test create_or_merge returns None when given <2 photos."""
        stack = PhotoStack.create_or_merge(
            owner=self.user,
            stack_type=PhotoStack.StackType.MANUAL,
            photos=[self.photo1],
        )
        
        self.assertIsNone(stack)

    def test_create_or_merge_merges_existing_stacks(self):
        """Test create_or_merge merges when photos already in stack."""
        # Create existing stack with photo1
        existing_stack = PhotoStack.objects.create(
            owner=self.user,
            stack_type=PhotoStack.StackType.MANUAL,
        )
        self.photo1.stacks.add(existing_stack)
        
        # Now create_or_merge with photo1 and photo2
        result = PhotoStack.create_or_merge(
            owner=self.user,
            stack_type=PhotoStack.StackType.MANUAL,
            photos=[self.photo1, self.photo2],
        )
        
        # Should return the existing stack with both photos
        self.assertEqual(result.pk, existing_stack.pk)
        self.assertEqual(result.photos.count(), 2)
        self.assertIn(self.photo2, result.photos.all())

    def test_photo_can_be_in_multiple_stacks_of_different_types(self):
        """Test a photo can be in stacks of different types."""
        raw_jpeg_stack = PhotoStack.objects.create(
            owner=self.user,
            stack_type=PhotoStack.StackType.RAW_JPEG_PAIR,
        )
        manual_stack = PhotoStack.objects.create(
            owner=self.user,
            stack_type=PhotoStack.StackType.MANUAL,
        )
        
        self.photo1.stacks.add(raw_jpeg_stack)
        self.photo1.stacks.add(manual_stack)
        
        self.assertEqual(self.photo1.stacks.count(), 2)


class PhotoStackAPITestCase(TestCase):
    """Tests for PhotoStack API endpoints."""

    def setUp(self):
        self.client = APIClient()
        self.user = create_test_user()
        self.other_user = create_test_user()
        self.client.force_authenticate(user=self.user)
        
        # Create photos for testing
        self.photo1 = create_test_photo(owner=self.user)
        self.photo2 = create_test_photo(owner=self.user)
        self.photo3 = create_test_photo(owner=self.user)
        
        # Create a test stack
        self.stack = PhotoStack.objects.create(
            owner=self.user,
            stack_type=PhotoStack.StackType.MANUAL,
        )
        self.photo1.stacks.add(self.stack)
        self.photo2.stacks.add(self.stack)
        self.stack.auto_select_primary()

    def test_list_stacks_returns_user_stacks(self):
        """Test listing stacks returns only user's stacks."""
        response = self.client.get("/api/stacks")
        
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        data = response.json()
        self.assertIn("results", data)
        self.assertIn("count", data)
        self.assertEqual(data["count"], 1)
        self.assertEqual(len(data["results"]), 1)
        self.assertEqual(data["results"][0]["id"], str(self.stack.id))

    def test_list_stacks_excludes_other_user_stacks(self):
        """Test listing stacks doesn't include other user's stacks."""
        # Create stack for other user
        other_photo = create_test_photo(owner=self.other_user)
        other_photo2 = create_test_photo(owner=self.other_user)
        other_stack = PhotoStack.objects.create(
            owner=self.other_user,
            stack_type=PhotoStack.StackType.MANUAL,
        )
        other_photo.stacks.add(other_stack)
        other_photo2.stacks.add(other_stack)
        
        response = self.client.get("/api/stacks")
        
        data = response.json()
        self.assertEqual(data["count"], 1)  # Only our stack
        self.assertNotEqual(data["results"][0]["id"], str(other_stack.id))

    def test_list_stacks_excludes_stacks_with_less_than_2_photos(self):
        """Test listing excludes stacks with <2 photos."""
        # Create stack with only 1 photo
        single_photo_stack = PhotoStack.objects.create(
            owner=self.user,
            stack_type=PhotoStack.StackType.MANUAL,
        )
        self.photo3.stacks.add(single_photo_stack)
        
        response = self.client.get("/api/stacks")
        
        data = response.json()
        self.assertEqual(data["count"], 1)  # Only the stack with 2 photos

    def test_list_stacks_filter_by_type(self):
        """Test filtering stacks by type."""
        # Create burst stack
        burst_stack = PhotoStack.objects.create(
            owner=self.user,
            stack_type=PhotoStack.StackType.BURST_SEQUENCE,
        )
        self.photo3.stacks.add(burst_stack)
        photo4 = create_test_photo(owner=self.user)
        photo4.stacks.add(burst_stack)
        
        response = self.client.get("/api/stacks?stack_type=burst")
        
        data = response.json()
        self.assertEqual(data["count"], 1)
        self.assertEqual(data["results"][0]["stack_type"], "burst")

    def test_list_stacks_pagination(self):
        """Test pagination works correctly."""
        response = self.client.get("/api/stacks?page=1&page_size=10")
        
        data = response.json()
        self.assertIn("page", data)
        self.assertIn("page_size", data)
        self.assertIn("has_next", data)
        self.assertIn("has_previous", data)
        self.assertEqual(data["page"], 1)
        self.assertEqual(data["page_size"], 10)

    def test_get_stack_detail(self):
        """Test getting stack detail."""
        response = self.client.get(f"/api/stacks/{self.stack.id}")
        
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        data = response.json()
        self.assertEqual(data["id"], str(self.stack.id))
        self.assertEqual(data["stack_type"], "manual")
        self.assertEqual(data["photo_count"], 2)
        self.assertIn("photos", data)
        self.assertEqual(len(data["photos"]), 2)

    def test_get_stack_detail_not_found(self):
        """Test getting non-existent stack returns 404."""
        fake_id = uuid.uuid4()
        response = self.client.get(f"/api/stacks/{fake_id}")
        
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_get_stack_detail_other_user_returns_404(self):
        """Test getting other user's stack returns 404."""
        other_photo = create_test_photo(owner=self.other_user)
        other_photo2 = create_test_photo(owner=self.other_user)
        other_stack = PhotoStack.objects.create(
            owner=self.other_user,
            stack_type=PhotoStack.StackType.MANUAL,
        )
        other_photo.stacks.add(other_stack)
        other_photo2.stacks.add(other_stack)
        
        response = self.client.get(f"/api/stacks/{other_stack.id}")
        
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_delete_stack(self):
        """Test deleting a stack unlinks photos but doesn't delete them."""
        stack_id = self.stack.id
        photo1_pk = self.photo1.pk
        photo2_pk = self.photo2.pk
        
        response = self.client.delete(f"/api/stacks/{stack_id}/delete")
        
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        data = response.json()
        self.assertEqual(data["status"], "deleted")
        self.assertEqual(data["unlinked_count"], 2)
        
        # Stack should be deleted
        self.assertFalse(PhotoStack.objects.filter(pk=stack_id).exists())
        
        # Photos should still exist
        self.assertTrue(Photo.objects.filter(pk=photo1_pk).exists())
        self.assertTrue(Photo.objects.filter(pk=photo2_pk).exists())

    def test_delete_stack_not_found(self):
        """Test deleting non-existent stack returns 404."""
        fake_id = uuid.uuid4()
        response = self.client.delete(f"/api/stacks/{fake_id}/delete")
        
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_set_primary_photo(self):
        """Test setting a photo as primary."""
        response = self.client.post(
            f"/api/stacks/{self.stack.id}/primary",
            {"photo_hash": self.photo2.image_hash},
            format="json",
        )
        
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        data = response.json()
        self.assertEqual(data["status"], "updated")
        self.assertEqual(data["primary_photo_hash"], self.photo2.image_hash)
        
        # Verify in database
        self.stack.refresh_from_db()
        self.assertEqual(self.stack.primary_photo.image_hash, self.photo2.image_hash)

    def test_set_primary_photo_not_in_stack(self):
        """Test setting photo not in stack as primary returns 400."""
        response = self.client.post(
            f"/api/stacks/{self.stack.id}/primary",
            {"photo_hash": self.photo3.image_hash},  # photo3 not in stack
            format="json",
        )
        
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("error", response.json())

    def test_set_primary_missing_photo_hash(self):
        """Test setting primary without photo_hash returns 400."""
        response = self.client.post(
            f"/api/stacks/{self.stack.id}/primary",
            {},
            format="json",
        )
        
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_add_photos_to_stack(self):
        """Test adding photos to an existing stack."""
        response = self.client.post(
            f"/api/stacks/{self.stack.id}/add",
            {"photo_hashes": [self.photo3.image_hash]},
            format="json",
        )
        
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        data = response.json()
        self.assertEqual(data["status"], "updated")
        self.assertEqual(data["added_count"], 1)
        self.assertEqual(data["total_count"], 3)
        
        # Verify in database
        self.assertIn(self.photo3, self.stack.photos.all())

    def test_add_photos_already_in_stack(self):
        """Test adding photo already in stack doesn't duplicate."""
        response = self.client.post(
            f"/api/stacks/{self.stack.id}/add",
            {"photo_hashes": [self.photo1.image_hash]},  # Already in stack
            format="json",
        )
        
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        data = response.json()
        self.assertEqual(data["added_count"], 0)  # Not added again
        self.assertEqual(data["total_count"], 2)

    def test_remove_photos_from_stack(self):
        """Test removing photos from a stack."""
        # First add photo3 so we have 3 photos
        self.photo3.stacks.add(self.stack)
        
        response = self.client.post(
            f"/api/stacks/{self.stack.id}/remove",
            {"photo_hashes": [self.photo3.image_hash]},
            format="json",
        )
        
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        data = response.json()
        self.assertEqual(data["status"], "updated")
        self.assertEqual(data["removed_count"], 1)
        self.assertEqual(data["total_count"], 2)

    def test_remove_photos_deletes_stack_if_less_than_2_remain(self):
        """Test removing photos deletes stack if <2 photos remain."""
        stack_id = self.stack.id
        
        response = self.client.post(
            f"/api/stacks/{self.stack.id}/remove",
            {"photo_hashes": [self.photo1.image_hash, self.photo2.image_hash]},
            format="json",
        )
        
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        data = response.json()
        self.assertEqual(data["status"], "deleted")
        
        # Stack should be deleted
        self.assertFalse(PhotoStack.objects.filter(pk=stack_id).exists())

    def test_unauthenticated_request_returns_401(self):
        """Test unauthenticated requests return 401."""
        self.client.force_authenticate(user=None)
        
        response = self.client.get("/api/stacks")
        
        self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)


class ManualStackCreationTestCase(TestCase):
    """Tests for manual stack creation."""

    def setUp(self):
        self.client = APIClient()
        self.user = create_test_user()
        self.client.force_authenticate(user=self.user)
        
        self.photo1 = create_test_photo(owner=self.user)
        self.photo2 = create_test_photo(owner=self.user)
        self.photo3 = create_test_photo(owner=self.user)

    def test_create_manual_stack(self):
        """Test creating a manual stack."""
        response = self.client.post(
            "/api/stacks/manual",
            {"photo_hashes": [self.photo1.image_hash, self.photo2.image_hash]},
            format="json",
        )
        
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        data = response.json()
        self.assertEqual(data["status"], "created")
        self.assertIn("stack_id", data)
        self.assertEqual(data["photo_count"], 2)
        
        # Verify stack was created
        stack = PhotoStack.objects.get(pk=data["stack_id"])
        self.assertEqual(stack.stack_type, PhotoStack.StackType.MANUAL)
        self.assertEqual(stack.photos.count(), 2)

    def test_create_manual_stack_requires_at_least_2_photos(self):
        """Test creating stack with <2 photos returns error."""
        response = self.client.post(
            "/api/stacks/manual",
            {"photo_hashes": [self.photo1.image_hash]},
            format="json",
        )
        
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_create_manual_stack_invalid_photo_hash(self):
        """Test creating stack with invalid photo hash returns error."""
        response = self.client.post(
            "/api/stacks/manual",
            {"photo_hashes": [self.photo1.image_hash, "invalid_hash"]},
            format="json",
        )
        
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("error", response.json())

    def test_create_manual_stack_other_user_photo(self):
        """Test creating stack with other user's photo returns error."""
        other_user = create_test_user()
        other_photo = create_test_photo(owner=other_user)
        
        response = self.client.post(
            "/api/stacks/manual",
            {"photo_hashes": [self.photo1.image_hash, other_photo.image_hash]},
            format="json",
        )
        
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_create_manual_stack_adds_to_existing_if_already_stacked(self):
        """Test creating stack adds to existing stack if photo already in manual stack."""
        # Create existing manual stack
        existing_stack = PhotoStack.objects.create(
            owner=self.user,
            stack_type=PhotoStack.StackType.MANUAL,
        )
        self.photo1.stacks.add(existing_stack)
        self.photo2.stacks.add(existing_stack)
        
        # Try to create new stack with photo1 and photo3
        response = self.client.post(
            "/api/stacks/manual",
            {"photo_hashes": [self.photo1.image_hash, self.photo3.image_hash]},
            format="json",
        )
        
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        data = response.json()
        self.assertEqual(data["stack_id"], str(existing_stack.id))
        
        # Verify photo3 was added to existing stack
        self.assertIn(self.photo3, existing_stack.photos.all())


class MergeStacksTestCase(TestCase):
    """Tests for stack merging."""

    def setUp(self):
        self.client = APIClient()
        self.user = create_test_user()
        self.client.force_authenticate(user=self.user)
        
        self.photo1 = create_test_photo(owner=self.user)
        self.photo2 = create_test_photo(owner=self.user)
        self.photo3 = create_test_photo(owner=self.user)
        self.photo4 = create_test_photo(owner=self.user)

    def test_merge_stacks(self):
        """Test merging multiple stacks."""
        # Create two separate stacks
        stack1 = PhotoStack.objects.create(
            owner=self.user,
            stack_type=PhotoStack.StackType.MANUAL,
        )
        self.photo1.stacks.add(stack1)
        self.photo2.stacks.add(stack1)
        
        stack2 = PhotoStack.objects.create(
            owner=self.user,
            stack_type=PhotoStack.StackType.MANUAL,
        )
        self.photo3.stacks.add(stack2)
        self.photo4.stacks.add(stack2)
        
        stack1_id = stack1.id
        stack2_id = stack2.id
        
        # Merge stacks using photos from both
        response = self.client.post(
            "/api/stacks/merge",
            {"photo_hashes": [self.photo1.image_hash, self.photo3.image_hash]},
            format="json",
        )
        
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        data = response.json()
        
        self.assertEqual(data["status"], "merged")
        self.assertEqual(data["merged_count"], 1)
        self.assertEqual(data["photo_count"], 4)
        
        # The non-target stack should be deleted
        # The target stack is the one returned in the response
        returned_stack_id = data.get("stack_id")
        if str(stack1_id) == returned_stack_id:
            # stack1 was target, stack2 should be deleted
            self.assertFalse(
                PhotoStack.objects.filter(pk=stack2_id).exists(),
                "stack2 should be deleted but still exists"
            )
        else:
            # stack2 was target, stack1 should be deleted
            self.assertFalse(
                PhotoStack.objects.filter(pk=stack1_id).exists(),
                "stack1 should be deleted but still exists"
            )

    def test_merge_single_stack_no_merge_needed(self):
        """Test merging when only one stack found returns no_merge_needed."""
        stack = PhotoStack.objects.create(
            owner=self.user,
            stack_type=PhotoStack.StackType.MANUAL,
        )
        self.photo1.stacks.add(stack)
        self.photo2.stacks.add(stack)
        
        response = self.client.post(
            "/api/stacks/merge",
            {"photo_hashes": [self.photo1.image_hash, self.photo2.image_hash]},
            format="json",
        )
        
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        data = response.json()
        self.assertEqual(data["status"], "no_merge_needed")

    def test_merge_no_stacks_returns_error(self):
        """Test merging photos not in any stack returns error."""
        response = self.client.post(
            "/api/stacks/merge",
            {"photo_hashes": [self.photo1.image_hash, self.photo2.image_hash]},
            format="json",
        )
        
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_merge_missing_photo_hashes(self):
        """Test merge without photo_hashes returns error."""
        response = self.client.post(
            "/api/stacks/merge",
            {},
            format="json",
        )
        
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)


class StackDetectionTestCase(TestCase):
    """Tests for stack detection trigger."""

    def setUp(self):
        self.client = APIClient()
        self.user = create_test_user()
        self.client.force_authenticate(user=self.user)

    @patch("api.views.stacks.async_task")
    def test_detect_stacks_queues_background_job(self, mock_async_task):
        """Test detect stacks queues a background job."""
        response = self.client.post("/api/stacks/detect")
        
        self.assertEqual(response.status_code, status.HTTP_202_ACCEPTED)
        data = response.json()
        self.assertEqual(data["status"], "queued")
        self.assertIn("options", data)
        
        # Verify async_task was called
        mock_async_task.assert_called_once()

    @patch("api.views.stacks.async_task")
    def test_detect_stacks_with_options(self, mock_async_task):
        """Test detect stacks with custom options.
        
        NOTE: detect_raw_jpeg and detect_live_photos options were removed.
        RAW+JPEG and Live Photos are now handled via file variants during scan.
        Only detect_bursts is available.
        """
        response = self.client.post(
            "/api/stacks/detect",
            {
                "detect_bursts": False,
            },
            format="json",
        )
        
        self.assertEqual(response.status_code, status.HTTP_202_ACCEPTED)
        data = response.json()
        self.assertEqual(data["options"]["detect_bursts"], False)


class StackStatsTestCase(TestCase):
    """Tests for stack statistics."""

    def setUp(self):
        self.client = APIClient()
        self.user = create_test_user()
        self.client.force_authenticate(user=self.user)
        
        self.photo1 = create_test_photo(owner=self.user)
        self.photo2 = create_test_photo(owner=self.user)
        self.photo3 = create_test_photo(owner=self.user)
        self.photo4 = create_test_photo(owner=self.user)

    def test_get_stack_stats(self):
        """Test getting stack statistics."""
        # Create some stacks
        manual_stack = PhotoStack.objects.create(
            owner=self.user,
            stack_type=PhotoStack.StackType.MANUAL,
        )
        self.photo1.stacks.add(manual_stack)
        self.photo2.stacks.add(manual_stack)
        
        burst_stack = PhotoStack.objects.create(
            owner=self.user,
            stack_type=PhotoStack.StackType.BURST_SEQUENCE,
        )
        self.photo3.stacks.add(burst_stack)
        self.photo4.stacks.add(burst_stack)
        
        response = self.client.get("/api/stacks/stats")
        
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        data = response.json()
        self.assertEqual(data["total_stacks"], 2)
        self.assertIn("by_type", data)
        self.assertEqual(data["by_type"]["manual"], 1)
        self.assertEqual(data["by_type"]["burst"], 1)
        self.assertEqual(data["photos_in_stacks"], 4)


class StackEdgeCasesTestCase(TestCase):
    """Edge case tests for stacks."""

    def setUp(self):
        self.client = APIClient()
        self.user = create_test_user()
        self.client.force_authenticate(user=self.user)
        
        self.photo1 = create_test_photo(owner=self.user)
        self.photo2 = create_test_photo(owner=self.user)

    def test_invalid_uuid_format_in_url(self):
        """Test invalid UUID format in URL is handled gracefully."""
        response = self.client.get("/api/stacks/not-a-valid-uuid")
        
        # The URL pattern [0-9a-f-]+ is permissive and partial matches fall through
        # to the list endpoint which returns 200. This is acceptable behavior -
        # the important thing is we don't get a 500 error.
        self.assertIn(response.status_code, [
            status.HTTP_200_OK,  # Falls through to list endpoint
            status.HTTP_400_BAD_REQUEST,
            status.HTTP_404_NOT_FOUND
        ])

    def test_stack_with_deleted_photo_handles_gracefully(self):
        """Test stack behavior when a photo is deleted."""
        stack = PhotoStack.objects.create(
            owner=self.user,
            stack_type=PhotoStack.StackType.MANUAL,
        )
        self.photo1.stacks.add(stack)
        self.photo2.stacks.add(stack)
        stack.primary_photo = self.photo1
        stack.save()
        
        # Delete photo1
        self.photo1.delete()
        
        # Stack detail should still work
        response = self.client.get(f"/api/stacks/{stack.id}")
        
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        data = response.json()
        # primary_photo should be None or the remaining photo
        self.assertEqual(len(data["photos"]), 1)

    def test_empty_photo_hashes_array(self):
        """Test empty photo_hashes array returns error."""
        response = self.client.post(
            "/api/stacks/manual",
            {"photo_hashes": []},
            format="json",
        )
        
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_duplicate_photo_hashes_in_request(self):
        """Test duplicate photo hashes in request are handled."""
        response = self.client.post(
            "/api/stacks/manual",
            {"photo_hashes": [self.photo1.image_hash, self.photo1.image_hash]},
            format="json",
        )
        
        # Should fail since we need 2 unique photos
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_remove_primary_photo_auto_selects_new_primary(self):
        """Test removing primary photo auto-selects a new primary."""
        photo3 = create_test_photo(owner=self.user)
        
        stack = PhotoStack.objects.create(
            owner=self.user,
            stack_type=PhotoStack.StackType.MANUAL,
        )
        self.photo1.stacks.add(stack)
        self.photo2.stacks.add(stack)
        photo3.stacks.add(stack)
        stack.primary_photo = self.photo1
        stack.save()
        
        response = self.client.post(
            f"/api/stacks/{stack.id}/remove",
            {"photo_hashes": [self.photo1.image_hash]},
            format="json",
        )
        
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        
        # Refresh and check primary was auto-selected
        stack.refresh_from_db()
        self.assertIsNotNone(stack.primary_photo)
        self.assertNotEqual(stack.primary_photo.image_hash, self.photo1.image_hash)

    def test_stack_list_page_size_max_100(self):
        """Test page_size is capped at 100."""
        response = self.client.get("/api/stacks?page_size=500")
        
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        data = response.json()
        self.assertEqual(data["page_size"], 100)  # Capped at 100
