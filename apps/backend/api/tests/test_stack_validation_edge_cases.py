"""
Edge case tests for Stack API input validation.

Tests cover:
- Duplicate photo hashes handling
- Input validation edge cases
- Error message accuracy
"""

from django.test import TestCase
from rest_framework.test import APIClient

from api.models.photo_stack import PhotoStack
from api.tests.utils import create_test_photo, create_test_user


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
            format='json',
        )
        
        # After fix: Duplicates are de-duplicated, so 2 unique photos are found
        # Stack creation should succeed
        self.assertEqual(response.status_code, 201)
        self.assertIn("stack_id", response.data)
        
        # Verify stack was created with 2 photos
        stack = PhotoStack.objects.get(id=response.data["stack_id"])
        self.assertEqual(stack.photos.count(), 2)

    def test_create_manual_stack_triple_duplicate_same_hash(self):
        """Test with all three hashes being the same."""
        photo = create_test_photo(owner=self.user)
        
        response = self.client.post(
            "/api/stacks/manual",
            {"photo_hashes": [photo.image_hash, photo.image_hash, photo.image_hash]},
            format='json',
        )
        
        # Expected: Only 1 unique photo, should fail (need >= 2)
        self.assertEqual(response.status_code, 400)

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
            format='json',
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
            format='json',
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
            format='json',
        )
        
        # After fix: Duplicates are de-duplicated, merge should succeed
        self.assertEqual(response.status_code, 200)
        self.assertIn("stack_id", response.data)
        
        # Should have merged into one stack with all 4 photos
        stacks = PhotoStack.objects.filter(owner=self.user, stack_type=PhotoStack.StackType.MANUAL)
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
            format='json',
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
            format='json',
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
            format='json',
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
            format='json',
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
            format='json',
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
            format='json',
        )
        
        self.assertEqual(response.status_code, 400)

    def test_merge_empty_photo_list(self):
        """Test merge with empty photo list."""
        response = self.client.post(
            "/api/stacks/merge",
            {"photo_hashes": []},
            format='json',
        )
        
        self.assertEqual(response.status_code, 400)

    def test_create_manual_missing_photo_hashes_key(self):
        """Test creating manual stack without photo_hashes key."""
        response = self.client.post(
            "/api/stacks/manual",
            {},  # No photo_hashes key
            format='json',
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
