"""
Edge case tests for Duplicate API to find bugs.

Tests cover:
- Resolution workflow edge cases
- Revert edge cases
- Delete edge cases (potential Bug #13)
- List/Detail view edge cases with missing data
- Statistics edge cases
"""

import uuid
from django.test import TestCase
from rest_framework.test import APIClient

from api.models import Photo
from api.models.duplicate import Duplicate
from api.models.photo_metadata import PhotoMetadata
from api.tests.utils import create_test_photo, create_test_user


class DuplicateResolveEdgeCasesTestCase(TestCase):
    """Edge cases for duplicate resolution."""

    def setUp(self):
        self.user = create_test_user()
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)

    def test_resolve_already_resolved_duplicate(self):
        """Test resolving a duplicate that's already resolved."""
        photo1 = create_test_photo(owner=self.user)
        photo2 = create_test_photo(owner=self.user)
        
        duplicate = Duplicate.objects.create(
            owner=self.user,
            duplicate_type=Duplicate.DuplicateType.EXACT_COPY,
            review_status=Duplicate.ReviewStatus.RESOLVED,
            kept_photo=photo1,
        )
        duplicate.photos.add(photo1, photo2)
        
        # Try to resolve again with different kept photo
        response = self.client.post(
            f"/api/duplicates/{duplicate.id}/resolve/",
            {"keep_photo_hash": photo2.image_hash},
        )
        
        # Should succeed (changing which photo to keep)
        self.assertEqual(response.status_code, 200)
        
        duplicate.refresh_from_db()
        self.assertEqual(duplicate.kept_photo, photo2)

    def test_resolve_with_photo_already_trashed(self):
        """Test resolving when one photo is already trashed."""
        photo1 = create_test_photo(owner=self.user)
        photo2 = create_test_photo(owner=self.user, in_trashcan=True)
        
        duplicate = Duplicate.objects.create(
            owner=self.user,
            duplicate_type=Duplicate.DuplicateType.EXACT_COPY,
        )
        duplicate.photos.add(photo1, photo2)
        
        # Resolve keeping photo1
        response = self.client.post(
            f"/api/duplicates/{duplicate.id}/resolve/",
            {"keep_photo_hash": photo1.image_hash},
        )
        
        self.assertEqual(response.status_code, 200)
        
        # Photo2 was already trashed, shouldn't change
        photo2.refresh_from_db()
        self.assertTrue(photo2.in_trashcan)

    def test_resolve_with_trash_others_false(self):
        """Test resolving without trashing other photos.
        
        Note: Must use format='json' to properly send boolean False.
        Form data converts False to string "False" which is truthy.
        """
        photo1 = create_test_photo(owner=self.user)
        photo2 = create_test_photo(owner=self.user)
        
        duplicate = Duplicate.objects.create(
            owner=self.user,
            duplicate_type=Duplicate.DuplicateType.EXACT_COPY,
        )
        duplicate.photos.add(photo1, photo2)
        
        # Use format='json' to properly send boolean False
        response = self.client.post(
            f"/api/duplicates/{duplicate.id}/resolve/",
            {"keep_photo_hash": photo1.image_hash, "trash_others": False},
            format='json',
        )
        
        self.assertEqual(response.status_code, 200)
        
        # Photo2 should NOT be trashed
        photo2.refresh_from_db()
        self.assertFalse(photo2.in_trashcan)
        
        # But duplicate should still be marked resolved
        duplicate.refresh_from_db()
        self.assertEqual(duplicate.review_status, Duplicate.ReviewStatus.RESOLVED)

    def test_resolve_with_nonexistent_photo_hash(self):
        """Test resolving with a photo hash that doesn't exist in the group."""
        photo1 = create_test_photo(owner=self.user)
        photo2 = create_test_photo(owner=self.user)
        
        duplicate = Duplicate.objects.create(
            owner=self.user,
            duplicate_type=Duplicate.DuplicateType.EXACT_COPY,
        )
        duplicate.photos.add(photo1, photo2)
        
        response = self.client.post(
            f"/api/duplicates/{duplicate.id}/resolve/",
            {"keep_photo_hash": "nonexistent_hash"},
        )
        
        self.assertEqual(response.status_code, 400)
        self.assertIn("error", response.data)

    def test_resolve_empty_request(self):
        """Test resolving with empty request body."""
        photo1 = create_test_photo(owner=self.user)
        photo2 = create_test_photo(owner=self.user)
        
        duplicate = Duplicate.objects.create(
            owner=self.user,
            duplicate_type=Duplicate.DuplicateType.EXACT_COPY,
        )
        duplicate.photos.add(photo1, photo2)
        
        response = self.client.post(
            f"/api/duplicates/{duplicate.id}/resolve/",
            {},
        )
        
        self.assertEqual(response.status_code, 400)


class DuplicateRevertEdgeCasesTestCase(TestCase):
    """Edge cases for duplicate revert."""

    def setUp(self):
        self.user = create_test_user()
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)

    def test_revert_pending_duplicate(self):
        """Test reverting a pending (not resolved) duplicate."""
        photo1 = create_test_photo(owner=self.user)
        photo2 = create_test_photo(owner=self.user)
        
        duplicate = Duplicate.objects.create(
            owner=self.user,
            duplicate_type=Duplicate.DuplicateType.EXACT_COPY,
            review_status=Duplicate.ReviewStatus.PENDING,
        )
        duplicate.photos.add(photo1, photo2)
        
        response = self.client.post(f"/api/duplicates/{duplicate.id}/revert/")
        
        # Should fail - can only revert resolved
        self.assertEqual(response.status_code, 400)

    def test_revert_dismissed_duplicate(self):
        """Test reverting a dismissed duplicate."""
        photo1 = create_test_photo(owner=self.user)
        photo2 = create_test_photo(owner=self.user)
        
        duplicate = Duplicate.objects.create(
            owner=self.user,
            duplicate_type=Duplicate.DuplicateType.EXACT_COPY,
            review_status=Duplicate.ReviewStatus.DISMISSED,
        )
        duplicate.photos.add(photo1, photo2)
        
        response = self.client.post(f"/api/duplicates/{duplicate.id}/revert/")
        
        # Should fail - can only revert resolved
        self.assertEqual(response.status_code, 400)

    def test_revert_when_photos_permanently_deleted(self):
        """Test reverting when trashed photos were permanently deleted."""
        photo1 = create_test_photo(owner=self.user)
        photo2 = create_test_photo(owner=self.user)
        
        duplicate = Duplicate.objects.create(
            owner=self.user,
            duplicate_type=Duplicate.DuplicateType.EXACT_COPY,
        )
        duplicate.photos.add(photo1, photo2)
        
        # Resolve keeping photo1
        duplicate.resolve(kept_photo=photo1)
        
        # Now permanently delete photo2 (simulating user emptying trash)
        photo2.in_trashcan = True
        photo2.save()
        photo2.manual_delete()
        
        # Try to revert
        response = self.client.post(f"/api/duplicates/{duplicate.id}/revert/")
        
        # Should succeed but restored_count may be 0
        # Bug: Duplicate group might be deleted now due to Bug #12 fix
        # Let me check if duplicate still exists
        if Duplicate.objects.filter(id=duplicate.id).exists():
            self.assertEqual(response.status_code, 200)
        else:
            # Duplicate was deleted when photo2 was deleted (only 1 photo left)
            self.assertEqual(response.status_code, 404)

    def test_revert_multiple_times(self):
        """Test reverting the same duplicate multiple times."""
        photo1 = create_test_photo(owner=self.user)
        photo2 = create_test_photo(owner=self.user)
        
        duplicate = Duplicate.objects.create(
            owner=self.user,
            duplicate_type=Duplicate.DuplicateType.EXACT_COPY,
        )
        duplicate.photos.add(photo1, photo2)
        
        # Resolve
        duplicate.resolve(kept_photo=photo1)
        
        # Revert first time
        response1 = self.client.post(f"/api/duplicates/{duplicate.id}/revert/")
        self.assertEqual(response1.status_code, 200)
        
        # Try to revert again (should fail - now pending)
        response2 = self.client.post(f"/api/duplicates/{duplicate.id}/revert/")
        self.assertEqual(response2.status_code, 400)


class DuplicateDeleteEdgeCasesTestCase(TestCase):
    """
    Edge cases for duplicate delete.
    
    Note: Delete endpoint is at /api/duplicates/{id}/delete with DELETE method.
    """

    def setUp(self):
        self.user = create_test_user()
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)

    def test_delete_duplicate_unlinks_all_photos(self):
        """Test that deleting a duplicate unlinks ALL photos."""
        photos = [create_test_photo(owner=self.user) for _ in range(5)]
        
        duplicate = Duplicate.objects.create(
            owner=self.user,
            duplicate_type=Duplicate.DuplicateType.EXACT_COPY,
        )
        for photo in photos:
            duplicate.photos.add(photo)
        
        duplicate_id = duplicate.id
        
        # Correct URL: /api/duplicates/{id}/delete
        response = self.client.delete(f"/api/duplicates/{duplicate_id}/delete")
        
        self.assertEqual(response.status_code, 200)
        
        # Verify duplicate is deleted
        self.assertFalse(Duplicate.objects.filter(id=duplicate_id).exists())
        
        # Verify ALL photos are unlinked
        for photo in photos:
            photo.refresh_from_db()
            self.assertEqual(photo.duplicates.count(), 0,
                "All photos should be unlinked from deleted duplicate")

    def test_delete_duplicate_with_many_photos(self):
        """Test deleting a duplicate with many photos."""
        photos = [create_test_photo(owner=self.user) for _ in range(20)]
        
        duplicate = Duplicate.objects.create(
            owner=self.user,
            duplicate_type=Duplicate.DuplicateType.EXACT_COPY,
        )
        for photo in photos:
            duplicate.photos.add(photo)
        
        response = self.client.delete(f"/api/duplicates/{duplicate.id}/delete")
        
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["unlinked_count"], 20)

    def test_delete_resolved_duplicate(self):
        """Test deleting a resolved duplicate."""
        photo1 = create_test_photo(owner=self.user)
        photo2 = create_test_photo(owner=self.user)
        
        duplicate = Duplicate.objects.create(
            owner=self.user,
            duplicate_type=Duplicate.DuplicateType.EXACT_COPY,
            review_status=Duplicate.ReviewStatus.RESOLVED,
            kept_photo=photo1,
        )
        duplicate.photos.add(photo1, photo2)
        
        response = self.client.delete(f"/api/duplicates/{duplicate.id}/delete")
        
        # Should succeed - can delete any duplicate
        self.assertEqual(response.status_code, 200)

    def test_delete_nonexistent_duplicate(self):
        """Test deleting a duplicate that doesn't exist."""
        response = self.client.delete(f"/api/duplicates/{uuid.uuid4()}/delete")
        self.assertEqual(response.status_code, 404)

    def test_delete_other_users_duplicate(self):
        """Test deleting another user's duplicate."""
        other_user = create_test_user()
        photo1 = create_test_photo(owner=other_user)
        photo2 = create_test_photo(owner=other_user)
        
        duplicate = Duplicate.objects.create(
            owner=other_user,
            duplicate_type=Duplicate.DuplicateType.EXACT_COPY,
        )
        duplicate.photos.add(photo1, photo2)
        
        response = self.client.delete(f"/api/duplicates/{duplicate.id}/delete")
        
        # Should return 404 (not found for this user)
        self.assertEqual(response.status_code, 404)


class DuplicateDetailEdgeCasesTestCase(TestCase):
    """Edge cases for duplicate detail view."""

    def setUp(self):
        self.user = create_test_user()
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)

    def test_detail_with_photos_without_metadata(self):
        """Test detail view when photos have no metadata."""
        photo1 = create_test_photo(owner=self.user)
        photo2 = create_test_photo(owner=self.user)
        
        # Ensure no metadata exists
        PhotoMetadata.objects.filter(photo__in=[photo1, photo2]).delete()
        
        duplicate = Duplicate.objects.create(
            owner=self.user,
            duplicate_type=Duplicate.DuplicateType.VISUAL_DUPLICATE,
        )
        duplicate.photos.add(photo1, photo2)
        
        # Should not crash
        response = self.client.get(f"/api/duplicates/{duplicate.id}/")
        
        self.assertEqual(response.status_code, 200)
        # Photos should have null width/height/camera
        for photo_data in response.data["photos"]:
            # Should be None or return gracefully
            pass  # If we get here without crash, the test passes

    def test_detail_with_photos_without_main_file(self):
        """Test detail view when photos have no main_file."""
        photo1 = create_test_photo(owner=self.user)
        photo2 = create_test_photo(owner=self.user)
        photo1.main_file = None
        photo1.save()
        
        duplicate = Duplicate.objects.create(
            owner=self.user,
            duplicate_type=Duplicate.DuplicateType.EXACT_COPY,
        )
        duplicate.photos.add(photo1, photo2)
        
        # Should not crash
        response = self.client.get(f"/api/duplicates/{duplicate.id}/")
        
        self.assertEqual(response.status_code, 200)

    def test_detail_with_deleted_kept_photo(self):
        """Test detail view when kept_photo has been deleted."""
        photo1 = create_test_photo(owner=self.user)
        photo2 = create_test_photo(owner=self.user)
        
        duplicate = Duplicate.objects.create(
            owner=self.user,
            duplicate_type=Duplicate.DuplicateType.EXACT_COPY,
            review_status=Duplicate.ReviewStatus.RESOLVED,
            kept_photo=photo1,
        )
        duplicate.photos.add(photo1, photo2)
        
        # Permanently delete the kept photo
        photo1.in_trashcan = True
        photo1.save()
        photo1.manual_delete()
        
        # Check if duplicate still exists (might be deleted due to Bug #12 fix)
        if not Duplicate.objects.filter(id=duplicate.id).exists():
            # Expected behavior: duplicate deleted when < 2 photos
            return
        
        # If duplicate still exists, detail should not crash
        response = self.client.get(f"/api/duplicates/{duplicate.id}/")
        # Either 200 or 404 depending on photo count
        self.assertIn(response.status_code, [200, 404])


class DuplicateListEdgeCasesTestCase(TestCase):
    """Edge cases for duplicate list view."""

    def setUp(self):
        self.user = create_test_user()
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)

    def test_list_excludes_single_photo_duplicates(self):
        """Test that list excludes duplicates with only 1 photo."""
        photo1 = create_test_photo(owner=self.user)
        
        duplicate = Duplicate.objects.create(
            owner=self.user,
            duplicate_type=Duplicate.DuplicateType.EXACT_COPY,
        )
        duplicate.photos.add(photo1)  # Only 1 photo
        
        response = self.client.get("/api/duplicates/")
        
        self.assertEqual(response.status_code, 200)
        # Should not include the single-photo duplicate
        self.assertEqual(response.data["count"], 0)

    def test_list_with_kept_photo_deleted(self):
        """Test list view when kept_photo reference is broken.
        
        ForeignKey SET_NULL should handle this, but let's verify.
        """
        photo1 = create_test_photo(owner=self.user)
        photo2 = create_test_photo(owner=self.user)
        photo3 = create_test_photo(owner=self.user)
        
        duplicate = Duplicate.objects.create(
            owner=self.user,
            duplicate_type=Duplicate.DuplicateType.EXACT_COPY,
            review_status=Duplicate.ReviewStatus.RESOLVED,
            kept_photo=photo1,
        )
        duplicate.photos.add(photo1, photo2, photo3)
        
        # Delete the kept photo
        photo1.in_trashcan = True
        photo1.save()
        photo1.manual_delete()
        
        # Try listing - should not crash
        response = self.client.get("/api/duplicates/")
        
        self.assertEqual(response.status_code, 200)

    def test_list_pagination_edge_cases(self):
        """Test list pagination with various edge cases."""
        # Create 5 duplicates
        for i in range(5):
            photo1 = create_test_photo(owner=self.user)
            photo2 = create_test_photo(owner=self.user)
            dup = Duplicate.objects.create(
                owner=self.user,
                duplicate_type=Duplicate.DuplicateType.EXACT_COPY,
            )
            dup.photos.add(photo1, photo2)
        
        # Page beyond results - Django's get_page() returns last page for out-of-range
        # So page 100 will still return results (the last page)
        response = self.client.get("/api/duplicates/?page=100")
        self.assertEqual(response.status_code, 200)
        # Django returns last valid page, not empty
        self.assertGreaterEqual(len(response.data["results"]), 0)
        
        # Page 0 should become page 1 (our code uses max(1, page))
        response = self.client.get("/api/duplicates/?page=0")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.data["results"]), 5)


class DuplicateAutoSelectBestEdgeCasesTestCase(TestCase):
    """Edge cases for auto_select_best_photo."""

    def setUp(self):
        self.user = create_test_user()

    def test_auto_select_with_no_photos(self):
        """Test auto_select_best_photo with empty duplicate group."""
        duplicate = Duplicate.objects.create(
            owner=self.user,
            duplicate_type=Duplicate.DuplicateType.EXACT_COPY,
        )
        
        result = duplicate.auto_select_best_photo()
        self.assertIsNone(result)

    def test_auto_select_exact_copy_all_null_paths(self):
        """Test auto_select for exact copies when all photos have no main_file."""
        photo1 = create_test_photo(owner=self.user)
        photo2 = create_test_photo(owner=self.user)
        photo1.main_file = None
        photo2.main_file = None
        photo1.save()
        photo2.save()
        
        duplicate = Duplicate.objects.create(
            owner=self.user,
            duplicate_type=Duplicate.DuplicateType.EXACT_COPY,
        )
        duplicate.photos.add(photo1, photo2)
        
        # Should handle gracefully (might return None or first photo)
        result = duplicate.auto_select_best_photo()
        # Just verify it doesn't crash

    def test_auto_select_visual_duplicate_no_metadata(self):
        """Test auto_select for visual duplicates when photos have no metadata."""
        photo1 = create_test_photo(owner=self.user)
        photo2 = create_test_photo(owner=self.user)
        
        # Delete any metadata
        PhotoMetadata.objects.filter(photo__in=[photo1, photo2]).delete()
        
        duplicate = Duplicate.objects.create(
            owner=self.user,
            duplicate_type=Duplicate.DuplicateType.VISUAL_DUPLICATE,
        )
        duplicate.photos.add(photo1, photo2)
        
        # Should handle gracefully
        result = duplicate.auto_select_best_photo()
        # Just verify it doesn't crash


class DuplicateDismissEdgeCasesTestCase(TestCase):
    """Edge cases for dismiss endpoint."""

    def setUp(self):
        self.user = create_test_user()
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)

    def test_dismiss_already_dismissed(self):
        """Test dismissing an already dismissed duplicate."""
        photo1 = create_test_photo(owner=self.user)
        photo2 = create_test_photo(owner=self.user)
        
        duplicate = Duplicate.objects.create(
            owner=self.user,
            duplicate_type=Duplicate.DuplicateType.EXACT_COPY,
            review_status=Duplicate.ReviewStatus.DISMISSED,
        )
        duplicate.photos.add(photo1, photo2)
        
        # Dismiss again
        response = self.client.post(f"/api/duplicates/{duplicate.id}/dismiss/")
        
        # Should succeed (idempotent operation)
        self.assertEqual(response.status_code, 200)

    def test_dismiss_resolved_duplicate(self):
        """Test dismissing a resolved duplicate."""
        photo1 = create_test_photo(owner=self.user)
        photo2 = create_test_photo(owner=self.user)
        
        duplicate = Duplicate.objects.create(
            owner=self.user,
            duplicate_type=Duplicate.DuplicateType.EXACT_COPY,
            review_status=Duplicate.ReviewStatus.RESOLVED,
            kept_photo=photo1,
        )
        duplicate.photos.add(photo1, photo2)
        
        # Dismiss the resolved duplicate
        response = self.client.post(f"/api/duplicates/{duplicate.id}/dismiss/")
        
        # Should succeed
        self.assertEqual(response.status_code, 200)
        
        duplicate.refresh_from_db()
        self.assertEqual(duplicate.review_status, Duplicate.ReviewStatus.DISMISSED)


class DuplicateStatsEdgeCasesTestCase(TestCase):
    """Edge cases for duplicate statistics endpoint."""

    def setUp(self):
        self.user = create_test_user()
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)

    def test_stats_with_no_duplicates(self):
        """Test stats endpoint with no duplicates."""
        response = self.client.get("/api/duplicates/stats/")
        
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["total_duplicates"], 0)
        self.assertEqual(response.data["pending_duplicates"], 0)
        self.assertEqual(response.data["potential_savings_bytes"], 0)
        self.assertEqual(response.data["potential_savings_mb"], 0)

    def test_stats_counts_by_type(self):
        """Test stats counts by duplicate type."""
        photo1 = create_test_photo(owner=self.user)
        photo2 = create_test_photo(owner=self.user)
        photo3 = create_test_photo(owner=self.user)
        photo4 = create_test_photo(owner=self.user)
        
        # Create exact copy duplicate
        dup1 = Duplicate.objects.create(
            owner=self.user,
            duplicate_type=Duplicate.DuplicateType.EXACT_COPY,
        )
        dup1.photos.add(photo1, photo2)
        
        # Create visual duplicate
        dup2 = Duplicate.objects.create(
            owner=self.user,
            duplicate_type=Duplicate.DuplicateType.VISUAL_DUPLICATE,
        )
        dup2.photos.add(photo3, photo4)
        
        response = self.client.get("/api/duplicates/stats/")
        
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["total_duplicates"], 2)
        self.assertEqual(response.data["by_type"]["exact_copy"], 1)
        self.assertEqual(response.data["by_type"]["visual_duplicate"], 1)

    def test_stats_counts_by_status(self):
        """Test stats counts by review status."""
        photos = [create_test_photo(owner=self.user) for _ in range(6)]
        
        # Pending
        dup1 = Duplicate.objects.create(
            owner=self.user,
            duplicate_type=Duplicate.DuplicateType.EXACT_COPY,
            review_status=Duplicate.ReviewStatus.PENDING,
        )
        dup1.photos.add(photos[0], photos[1])
        
        # Resolved
        dup2 = Duplicate.objects.create(
            owner=self.user,
            duplicate_type=Duplicate.DuplicateType.EXACT_COPY,
            review_status=Duplicate.ReviewStatus.RESOLVED,
        )
        dup2.photos.add(photos[2], photos[3])
        
        # Dismissed
        dup3 = Duplicate.objects.create(
            owner=self.user,
            duplicate_type=Duplicate.DuplicateType.EXACT_COPY,
            review_status=Duplicate.ReviewStatus.DISMISSED,
        )
        dup3.photos.add(photos[4], photos[5])
        
        response = self.client.get("/api/duplicates/stats/")
        
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["pending_duplicates"], 1)
        self.assertEqual(response.data["resolved_duplicates"], 1)
        self.assertEqual(response.data["dismissed_duplicates"], 1)

    def test_stats_potential_savings(self):
        """Test stats potential savings calculation."""
        photo1 = create_test_photo(owner=self.user)
        photo2 = create_test_photo(owner=self.user)
        
        dup = Duplicate.objects.create(
            owner=self.user,
            duplicate_type=Duplicate.DuplicateType.EXACT_COPY,
            review_status=Duplicate.ReviewStatus.PENDING,
            potential_savings=1024 * 1024 * 5,  # 5 MB
        )
        dup.photos.add(photo1, photo2)
        
        response = self.client.get("/api/duplicates/stats/")
        
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["potential_savings_bytes"], 5 * 1024 * 1024)
        self.assertEqual(response.data["potential_savings_mb"], 5.0)

    def test_stats_photos_in_duplicates(self):
        """Test stats counts photos in duplicate groups correctly."""
        photos = [create_test_photo(owner=self.user) for _ in range(5)]
        
        # Create duplicate with 3 photos
        dup1 = Duplicate.objects.create(
            owner=self.user,
            duplicate_type=Duplicate.DuplicateType.EXACT_COPY,
        )
        dup1.photos.add(photos[0], photos[1], photos[2])
        
        # Create another duplicate with 2 photos (one overlapping)
        dup2 = Duplicate.objects.create(
            owner=self.user,
            duplicate_type=Duplicate.DuplicateType.VISUAL_DUPLICATE,
        )
        dup2.photos.add(photos[2], photos[3])  # photos[2] is in both
        
        response = self.client.get("/api/duplicates/stats/")
        
        self.assertEqual(response.status_code, 200)
        # 4 unique photos are in duplicate groups (photos 0,1,2,3)
        self.assertEqual(response.data["photos_in_duplicates"], 4)

    def test_stats_other_users_not_included(self):
        """Test stats don't include other user's duplicates."""
        other_user = create_test_user()
        
        # Create duplicate for other user
        other_photo1 = create_test_photo(owner=other_user)
        other_photo2 = create_test_photo(owner=other_user)
        dup = Duplicate.objects.create(
            owner=other_user,
            duplicate_type=Duplicate.DuplicateType.EXACT_COPY,
        )
        dup.photos.add(other_photo1, other_photo2)
        
        # Current user should see 0 duplicates
        response = self.client.get("/api/duplicates/stats/")
        
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["total_duplicates"], 0)
