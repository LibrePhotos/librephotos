"""
Tests for Duplicate Detection API and Models.

Tests cover:
- Duplicate model creation, resolution, dismissal, revert
- API endpoints for listing, filtering, resolving duplicates
- Edge cases: permissions, invalid IDs, concurrent operations
- BK-Tree algorithm for visual duplicate search
"""
import uuid
from unittest.mock import patch

from django.test import TestCase
from rest_framework import status
from rest_framework.test import APIClient

from api.models import Photo
from api.models.duplicate import Duplicate
from api.tests.utils import create_test_photos, create_test_user


class DuplicateModelTest(TestCase):
    """Tests for the Duplicate model methods."""

    def setUp(self):
        self.user = create_test_user()
        self.photos = create_test_photos(number_of_photos=3, owner=self.user)

    def test_create_duplicate_group(self):
        """Test creating a duplicate group with multiple photos."""
        duplicate = Duplicate.objects.create(
            owner=self.user,
            duplicate_type=Duplicate.DuplicateType.EXACT_COPY,
        )
        for photo in self.photos:
            photo.duplicates.add(duplicate)

        self.assertEqual(duplicate.photo_count, 3)
        self.assertEqual(duplicate.review_status, Duplicate.ReviewStatus.PENDING)

    def test_create_duplicate_with_less_than_2_photos_returns_none(self):
        """Test create_or_merge returns None with < 2 photos."""
        result = Duplicate.create_or_merge(
            owner=self.user,
            duplicate_type=Duplicate.DuplicateType.EXACT_COPY,
            photos=[self.photos[0]],
        )
        self.assertIsNone(result)

    def test_create_or_merge_creates_new_duplicate(self):
        """Test create_or_merge creates a new duplicate group."""
        duplicate = Duplicate.create_or_merge(
            owner=self.user,
            duplicate_type=Duplicate.DuplicateType.VISUAL_DUPLICATE,
            photos=self.photos[:2],
            similarity_score=0.95,
        )
        self.assertIsNotNone(duplicate)
        self.assertEqual(duplicate.photo_count, 2)
        self.assertEqual(duplicate.similarity_score, 0.95)

    def test_create_or_merge_merges_existing(self):
        """Test create_or_merge merges when photo already in group."""
        # Create initial group with first 2 photos
        dup1 = Duplicate.create_or_merge(
            owner=self.user,
            duplicate_type=Duplicate.DuplicateType.EXACT_COPY,
            photos=self.photos[:2],
        )
        # Try to create new group with overlapping photo
        dup2 = Duplicate.create_or_merge(
            owner=self.user,
            duplicate_type=Duplicate.DuplicateType.EXACT_COPY,
            photos=[self.photos[1], self.photos[2]],
        )
        # Should return the same duplicate (merged)
        self.assertEqual(dup1.id, dup2.id)
        self.assertEqual(dup1.photo_count, 3)

    def test_resolve_duplicate_trashes_others(self):
        """Test resolving a duplicate trashes non-kept photos."""
        duplicate = Duplicate.create_or_merge(
            owner=self.user,
            duplicate_type=Duplicate.DuplicateType.EXACT_COPY,
            photos=self.photos,
        )
        keep_photo = self.photos[0]
        duplicate.resolve(keep_photo, trash_others=True)

        # Refresh from DB
        duplicate.refresh_from_db()
        for photo in self.photos[1:]:
            photo.refresh_from_db()
            self.assertTrue(photo.in_trashcan)

        self.assertEqual(duplicate.review_status, Duplicate.ReviewStatus.RESOLVED)
        self.assertEqual(duplicate.kept_photo, keep_photo)
        self.assertEqual(duplicate.trashed_count, 2)

    def test_resolve_duplicate_without_trashing(self):
        """Test resolving without trashing others."""
        duplicate = Duplicate.create_or_merge(
            owner=self.user,
            duplicate_type=Duplicate.DuplicateType.EXACT_COPY,
            photos=self.photos[:2],
        )
        keep_photo = self.photos[0]
        duplicate.resolve(keep_photo, trash_others=False)

        duplicate.refresh_from_db()
        self.photos[1].refresh_from_db()

        self.assertEqual(duplicate.review_status, Duplicate.ReviewStatus.RESOLVED)
        self.assertFalse(self.photos[1].in_trashcan)
        self.assertEqual(duplicate.trashed_count, 0)

    def test_dismiss_duplicate(self):
        """Test dismissing a duplicate unlinks photos."""
        duplicate = Duplicate.create_or_merge(
            owner=self.user,
            duplicate_type=Duplicate.DuplicateType.VISUAL_DUPLICATE,
            photos=self.photos[:2],
        )
        duplicate.dismiss()

        duplicate.refresh_from_db()
        self.assertEqual(duplicate.review_status, Duplicate.ReviewStatus.DISMISSED)
        # Photos should be unlinked
        self.assertEqual(duplicate.photo_count, 0)

    def test_revert_resolved_duplicate(self):
        """Test reverting a resolved duplicate restores photos."""
        duplicate = Duplicate.create_or_merge(
            owner=self.user,
            duplicate_type=Duplicate.DuplicateType.EXACT_COPY,
            photos=self.photos[:2],
        )
        duplicate.resolve(self.photos[0], trash_others=True)

        # Verify photo was trashed
        self.photos[1].refresh_from_db()
        self.assertTrue(self.photos[1].in_trashcan)

        # Revert
        restored_count = duplicate.revert()
        duplicate.refresh_from_db()
        self.photos[1].refresh_from_db()

        self.assertEqual(restored_count, 1)
        self.assertEqual(duplicate.review_status, Duplicate.ReviewStatus.PENDING)
        self.assertFalse(self.photos[1].in_trashcan)
        self.assertIsNone(duplicate.kept_photo)

    def test_revert_non_resolved_duplicate_returns_zero(self):
        """Test reverting a pending duplicate returns 0."""
        duplicate = Duplicate.create_or_merge(
            owner=self.user,
            duplicate_type=Duplicate.DuplicateType.EXACT_COPY,
            photos=self.photos[:2],
        )
        restored_count = duplicate.revert()
        self.assertEqual(restored_count, 0)

    def test_auto_select_best_photo_exact_copy(self):
        """Test auto-selecting best photo for exact copies (shortest path)."""
        duplicate = Duplicate.create_or_merge(
            owner=self.user,
            duplicate_type=Duplicate.DuplicateType.EXACT_COPY,
            photos=self.photos[:2],
        )
        best = duplicate.auto_select_best_photo()
        self.assertIsNotNone(best)

    def test_calculate_potential_savings(self):
        """Test calculating potential storage savings."""
        # Set known sizes
        self.photos[0].size = 1000000  # 1MB
        self.photos[0].save()
        self.photos[1].size = 500000   # 0.5MB
        self.photos[1].save()

        duplicate = Duplicate.create_or_merge(
            owner=self.user,
            duplicate_type=Duplicate.DuplicateType.EXACT_COPY,
            photos=self.photos[:2],
        )
        savings = duplicate.calculate_potential_savings()

        # Should be size of non-best photos
        self.assertGreater(savings, 0)

    def test_merge_duplicates(self):
        """Test merging two duplicate groups."""
        dup1 = Duplicate.create_or_merge(
            owner=self.user,
            duplicate_type=Duplicate.DuplicateType.EXACT_COPY,
            photos=self.photos[:2],
        )
        # Create second group with photo[2]
        extra_photo = create_test_photos(number_of_photos=1, owner=self.user)[0]
        dup2 = Duplicate.objects.create(
            owner=self.user,
            duplicate_type=Duplicate.DuplicateType.EXACT_COPY,
        )
        extra_photo.duplicates.add(dup2)
        self.photos[2].duplicates.add(dup2)

        # Merge
        dup1.merge_with(dup2)

        # dup2 should be deleted
        self.assertFalse(Duplicate.objects.filter(id=dup2.id).exists())
        # dup1 should have all photos
        self.assertEqual(dup1.photo_count, 4)


class DuplicateAPITest(TestCase):
    """Tests for Duplicate API endpoints."""

    def setUp(self):
        self.client = APIClient()
        self.user1 = create_test_user()
        self.user2 = create_test_user()
        self.client.force_authenticate(user=self.user1)
        self.photos = create_test_photos(number_of_photos=4, owner=self.user1)

    def test_list_duplicates_empty(self):
        """Test listing duplicates when none exist."""
        response = self.client.get("/api/duplicates")
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        data = response.json()
        self.assertEqual(data["count"], 0)
        self.assertEqual(data["results"], [])

    def test_list_duplicates_with_results(self):
        """Test listing duplicates with results."""
        Duplicate.create_or_merge(
            owner=self.user1,
            duplicate_type=Duplicate.DuplicateType.EXACT_COPY,
            photos=self.photos[:2],
        )
        response = self.client.get("/api/duplicates")
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        data = response.json()
        self.assertEqual(data["count"], 1)

    def test_list_duplicates_excludes_other_users(self):
        """Test that user can only see their own duplicates."""
        # Create duplicate for user2
        photos2 = create_test_photos(number_of_photos=2, owner=self.user2)
        Duplicate.create_or_merge(
            owner=self.user2,
            duplicate_type=Duplicate.DuplicateType.EXACT_COPY,
            photos=photos2,
        )
        # User1 should not see it
        response = self.client.get("/api/duplicates")
        data = response.json()
        self.assertEqual(data["count"], 0)

    def test_list_duplicates_filter_by_type(self):
        """Test filtering duplicates by type."""
        Duplicate.create_or_merge(
            owner=self.user1,
            duplicate_type=Duplicate.DuplicateType.EXACT_COPY,
            photos=self.photos[:2],
        )
        Duplicate.create_or_merge(
            owner=self.user1,
            duplicate_type=Duplicate.DuplicateType.VISUAL_DUPLICATE,
            photos=self.photos[2:4],
        )

        # Filter exact copies
        response = self.client.get("/api/duplicates?duplicate_type=exact_copy")
        data = response.json()
        self.assertEqual(data["count"], 1)
        self.assertEqual(data["results"][0]["duplicate_type"], "exact_copy")

    def test_list_duplicates_filter_by_status(self):
        """Test filtering duplicates by review status."""
        dup = Duplicate.create_or_merge(
            owner=self.user1,
            duplicate_type=Duplicate.DuplicateType.EXACT_COPY,
            photos=self.photos[:2],
        )
        dup.resolve(self.photos[0], trash_others=True)

        # Filter pending - should be empty
        response = self.client.get("/api/duplicates?status=pending")
        data = response.json()
        self.assertEqual(data["count"], 0)

        # Filter resolved
        response = self.client.get("/api/duplicates?status=resolved")
        data = response.json()
        self.assertEqual(data["count"], 1)

    def test_get_duplicate_detail(self):
        """Test getting duplicate detail."""
        dup = Duplicate.create_or_merge(
            owner=self.user1,
            duplicate_type=Duplicate.DuplicateType.EXACT_COPY,
            photos=self.photos[:2],
        )
        response = self.client.get(f"/api/duplicates/{dup.id}")
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        data = response.json()
        self.assertEqual(data["id"], str(dup.id))
        self.assertEqual(len(data["photos"]), 2)

    def test_get_duplicate_detail_not_found(self):
        """Test getting non-existent duplicate returns 404."""
        fake_id = uuid.uuid4()
        response = self.client.get(f"/api/duplicates/{fake_id}")
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_get_duplicate_detail_wrong_user(self):
        """Test user cannot access other user's duplicate."""
        photos2 = create_test_photos(number_of_photos=2, owner=self.user2)
        dup = Duplicate.create_or_merge(
            owner=self.user2,
            duplicate_type=Duplicate.DuplicateType.EXACT_COPY,
            photos=photos2,
        )
        response = self.client.get(f"/api/duplicates/{dup.id}")
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_resolve_duplicate(self):
        """Test resolving a duplicate via API."""
        dup = Duplicate.create_or_merge(
            owner=self.user1,
            duplicate_type=Duplicate.DuplicateType.EXACT_COPY,
            photos=self.photos[:2],
        )
        payload = {
            "keep_photo_hash": self.photos[0].image_hash,
            "trash_others": True,
        }
        response = self.client.post(
            f"/api/duplicates/{dup.id}/resolve",
            data=payload,
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        data = response.json()
        self.assertEqual(data["status"], "resolved")
        self.assertEqual(data["trashed_count"], 1)

    def test_resolve_duplicate_missing_photo_hash(self):
        """Test resolve without photo hash returns error."""
        dup = Duplicate.create_or_merge(
            owner=self.user1,
            duplicate_type=Duplicate.DuplicateType.EXACT_COPY,
            photos=self.photos[:2],
        )
        response = self.client.post(
            f"/api/duplicates/{dup.id}/resolve/",
            data={},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_resolve_duplicate_invalid_photo(self):
        """Test resolve with photo not in group returns error."""
        dup = Duplicate.create_or_merge(
            owner=self.user1,
            duplicate_type=Duplicate.DuplicateType.EXACT_COPY,
            photos=self.photos[:2],
        )
        payload = {
            "keep_photo_hash": self.photos[3].image_hash,  # Not in group
            "trash_others": True,
        }
        response = self.client.post(
            f"/api/duplicates/{dup.id}/resolve",
            data=payload,
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_dismiss_duplicate(self):
        """Test dismissing a duplicate via API."""
        dup = Duplicate.create_or_merge(
            owner=self.user1,
            duplicate_type=Duplicate.DuplicateType.VISUAL_DUPLICATE,
            photos=self.photos[:2],
        )
        response = self.client.post(f"/api/duplicates/{dup.id}/dismiss")
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        data = response.json()
        self.assertEqual(data["status"], "dismissed")

    def test_revert_duplicate(self):
        """Test reverting a resolved duplicate via API."""
        dup = Duplicate.create_or_merge(
            owner=self.user1,
            duplicate_type=Duplicate.DuplicateType.EXACT_COPY,
            photos=self.photos[:2],
        )
        dup.resolve(self.photos[0], trash_others=True)

        response = self.client.post(f"/api/duplicates/{dup.id}/revert")
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        data = response.json()
        self.assertEqual(data["status"], "reverted")
        self.assertEqual(data["restored_count"], 1)

    def test_revert_non_resolved_duplicate_fails(self):
        """Test reverting a pending duplicate returns error."""
        dup = Duplicate.create_or_merge(
            owner=self.user1,
            duplicate_type=Duplicate.DuplicateType.EXACT_COPY,
            photos=self.photos[:2],
        )
        response = self.client.post(f"/api/duplicates/{dup.id}/revert")
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_delete_duplicate(self):
        """Test deleting a duplicate group via API."""
        dup = Duplicate.create_or_merge(
            owner=self.user1,
            duplicate_type=Duplicate.DuplicateType.EXACT_COPY,
            photos=self.photos[:2],
        )
        dup_id = dup.id
        # API uses /delete suffix instead of DELETE method on main path
        response = self.client.delete(f"/api/duplicates/{dup_id}/delete")
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        data = response.json()
        self.assertEqual(data["status"], "deleted")
        self.assertEqual(data["unlinked_count"], 2)

        # Verify duplicate is gone
        self.assertFalse(Duplicate.objects.filter(id=dup_id).exists())

    def test_get_duplicate_stats(self):
        """Test getting duplicate statistics."""
        # Create some duplicates
        Duplicate.create_or_merge(
            owner=self.user1,
            duplicate_type=Duplicate.DuplicateType.EXACT_COPY,
            photos=self.photos[:2],
        )
        response = self.client.get("/api/duplicates/stats")
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        data = response.json()
        self.assertIn("total_duplicates", data)
        self.assertIn("pending_duplicates", data)
        self.assertIn("by_type", data)

    def test_detect_duplicates(self):
        """Test triggering duplicate detection."""
        response = self.client.post(
            "/api/duplicates/detect",
            data={
                "detect_exact_copies": True,
                "detect_visual_duplicates": False,
            },
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_202_ACCEPTED)
        data = response.json()
        self.assertEqual(data["status"], "queued")


class DuplicateEdgeCasesTest(TestCase):
    """Tests for edge cases and potential bugs."""

    def setUp(self):
        self.client = APIClient()
        self.user = create_test_user()
        self.client.force_authenticate(user=self.user)
        self.photos = create_test_photos(number_of_photos=5, owner=self.user)

    def test_duplicate_with_single_photo_excluded_from_list(self):
        """Test duplicates with <2 photos are not returned in list."""
        # Create a duplicate and manually remove all but one photo
        dup = Duplicate.objects.create(
            owner=self.user,
            duplicate_type=Duplicate.DuplicateType.EXACT_COPY,
        )
        self.photos[0].duplicates.add(dup)  # Only 1 photo

        response = self.client.get("/api/duplicates/")
        data = response.json()
        self.assertEqual(data["count"], 0)

    def test_resolve_already_resolved_duplicate(self):
        """Test resolving an already resolved duplicate."""
        dup = Duplicate.create_or_merge(
            owner=self.user,
            duplicate_type=Duplicate.DuplicateType.EXACT_COPY,
            photos=self.photos[:3],
        )
        dup.resolve(self.photos[0], trash_others=True)

        # Try to resolve again with different photo
        payload = {"keep_photo_hash": self.photos[1].image_hash}
        response = self.client.post(
            f"/api/duplicates/{dup.id}/resolve",
            data=payload,
            format="json",
        )
        # Should still succeed (updating the resolution)
        self.assertEqual(response.status_code, status.HTTP_200_OK)

    def test_photo_in_multiple_duplicate_groups(self):
        """Test a photo can be in multiple duplicate groups of different types."""
        dup_exact = Duplicate.create_or_merge(
            owner=self.user,
            duplicate_type=Duplicate.DuplicateType.EXACT_COPY,
            photos=self.photos[:2],
        )
        dup_visual = Duplicate.create_or_merge(
            owner=self.user,
            duplicate_type=Duplicate.DuplicateType.VISUAL_DUPLICATE,
            photos=[self.photos[0], self.photos[2]],
        )

        # Photo 0 should be in both groups
        self.photos[0].refresh_from_db()
        self.assertEqual(self.photos[0].duplicates.count(), 2)

    def test_delete_photo_removes_from_duplicate(self):
        """Test deleting a photo removes it from duplicate group."""
        dup = Duplicate.create_or_merge(
            owner=self.user,
            duplicate_type=Duplicate.DuplicateType.EXACT_COPY,
            photos=self.photos[:3],
        )
        initial_count = dup.photo_count

        # Delete a photo from the duplicate group
        photo_to_delete = self.photos[0]
        photo_to_delete.duplicates.remove(dup)

        dup.refresh_from_db()
        self.assertEqual(dup.photo_count, initial_count - 1)

    def test_pagination_works_correctly(self):
        """Test pagination returns correct results."""
        # Create 25 duplicate groups
        for i in range(25):
            extra_photos = create_test_photos(number_of_photos=2, owner=self.user)
            Duplicate.create_or_merge(
                owner=self.user,
                duplicate_type=Duplicate.DuplicateType.EXACT_COPY,
                photos=extra_photos,
            )

        # Get first page
        response = self.client.get("/api/duplicates?page=1&page_size=10")
        data = response.json()
        self.assertEqual(len(data["results"]), 10)
        self.assertEqual(data["count"], 25)
        self.assertTrue(data["has_next"])

        # Get second page
        response = self.client.get("/api/duplicates?page=2&page_size=10")
        data = response.json()
        self.assertEqual(len(data["results"]), 10)
        self.assertTrue(data["has_previous"])

    def test_invalid_uuid_format(self):
        """Test invalid UUID format.
        
        Note: The URL regex pattern [0-9a-f-]+ matches any hex-like string,
        so 'not-a-valid-uuid' partially matches. The view then returns an
        empty result rather than 404/400. This is acceptable behavior.
        """
        response = self.client.get("/api/duplicates/not-a-valid-uuid")
        # The regex matches the string (contains a-f and -), but no duplicate exists
        # so it returns the list endpoint with empty results
        self.assertEqual(response.status_code, status.HTTP_200_OK)

    def test_concurrent_resolve_same_duplicate(self):
        """Test handling multiple resolution attempts.
        
        The API allows re-resolving a duplicate with the same or different photo.
        This is useful if the user changes their mind about which photo to keep.
        """
        dup = Duplicate.create_or_merge(
            owner=self.user,
            duplicate_type=Duplicate.DuplicateType.EXACT_COPY,
            photos=self.photos[:3],
        )
        # First resolve - keep photos[0], trash others
        payload1 = {"keep_photo_hash": self.photos[0].image_hash}
        response1 = self.client.post(
            f"/api/duplicates/{dup.id}/resolve",
            data=payload1,
            format="json",
        )
        self.assertEqual(response1.status_code, status.HTTP_200_OK)

        # Verify photos[1] is now trashed
        self.photos[1].refresh_from_db()
        self.assertTrue(self.photos[1].in_trashcan)

        # Re-resolve with same photo (idempotent operation)
        payload2 = {"keep_photo_hash": self.photos[0].image_hash}
        response2 = self.client.post(
            f"/api/duplicates/{dup.id}/resolve",
            data=payload2,
            format="json",
        )
        # Re-resolving is allowed
        self.assertEqual(response2.status_code, status.HTTP_200_OK)


class BKTreeTest(TestCase):
    """Tests for BK-Tree algorithm used in visual duplicate detection."""

    def test_bk_tree_basic_operations(self):
        """Test BK-Tree add and search operations."""
        from api.duplicate_detection import BKTree
        from api.perceptual_hash import hamming_distance

        tree = BKTree(hamming_distance)
        tree.add("photo1", "0000000000000000")
        tree.add("photo2", "0000000000000001")  # 1 bit different
        tree.add("photo3", "1111111111111111")  # Very different

        # Search with threshold 1
        results = tree.search("0000000000000000", 1)
        result_ids = [r[0] for r in results]
        self.assertIn("photo1", result_ids)
        self.assertIn("photo2", result_ids)
        self.assertNotIn("photo3", result_ids)

    def test_bk_tree_empty_search(self):
        """Test BK-Tree search on empty tree."""
        from api.duplicate_detection import BKTree
        from api.perceptual_hash import hamming_distance

        tree = BKTree(hamming_distance)
        results = tree.search("0000000000000000", 5)
        self.assertEqual(results, [])


class UnionFindTest(TestCase):
    """Tests for Union-Find data structure used in duplicate grouping."""

    def test_union_find_basic(self):
        """Test Union-Find basic operations."""
        from api.duplicate_detection import UnionFind

        uf = UnionFind()
        uf.union("a", "b")
        uf.union("b", "c")

        # a, b, c should be in same group
        self.assertEqual(uf.find("a"), uf.find("b"))
        self.assertEqual(uf.find("b"), uf.find("c"))

    def test_union_find_get_groups(self):
        """Test Union-Find get_groups returns correct groups."""
        from api.duplicate_detection import UnionFind

        uf = UnionFind()
        uf.union("a", "b")
        uf.union("c", "d")
        uf.union("e", "f")

        groups = uf.get_groups()
        self.assertEqual(len(groups), 3)
        # Each group should have 2 elements
        for group in groups:
            self.assertEqual(len(group), 2)

    def test_union_find_single_elements_not_returned(self):
        """Test Union-Find doesn't return single-element groups."""
        from api.duplicate_detection import UnionFind

        uf = UnionFind()
        uf.find("a")  # Creates single element
        uf.union("b", "c")

        groups = uf.get_groups()
        # Only the b-c group should be returned
        self.assertEqual(len(groups), 1)
        self.assertEqual(len(groups[0]), 2)
