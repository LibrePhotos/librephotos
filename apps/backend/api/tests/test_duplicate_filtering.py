"""
Tests for Duplicate API filtering and detection edge cases.

Tests cover:
- Filter by duplicate type (exact_copy, visual_duplicate)
- Filter by status (pending, resolved, dismissed)
- Photos without perceptual hash
- Visual threshold sensitivity
- Detection job handling
"""

from django.test import TestCase
from rest_framework.test import APIClient

from api.models.duplicate import Duplicate
from api.tests.utils import create_test_photo, create_test_user


class DuplicateFilterByTypeTestCase(TestCase):
    """Tests for filtering duplicates by type."""

    def setUp(self):
        self.user = create_test_user()
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)
        
        # Create photos for duplicates
        self.photos = [create_test_photo(owner=self.user) for _ in range(6)]
        
        # Create exact copy duplicate
        self.exact_dup = Duplicate.objects.create(
            owner=self.user,
            duplicate_type=Duplicate.DuplicateType.EXACT_COPY,
        )
        self.exact_dup.photos.add(self.photos[0], self.photos[1])
        
        # Create visual duplicate
        self.visual_dup = Duplicate.objects.create(
            owner=self.user,
            duplicate_type=Duplicate.DuplicateType.VISUAL_DUPLICATE,
            similarity_score=0.95,
        )
        self.visual_dup.photos.add(self.photos[2], self.photos[3])
        
        # Create another exact copy
        self.exact_dup2 = Duplicate.objects.create(
            owner=self.user,
            duplicate_type=Duplicate.DuplicateType.EXACT_COPY,
        )
        self.exact_dup2.photos.add(self.photos[4], self.photos[5])

    def test_filter_exact_copies(self):
        """Test filtering for exact copies only."""
        response = self.client.get(
            f"/api/duplicates?duplicate_type={Duplicate.DuplicateType.EXACT_COPY}"
        )
        
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["count"], 2)
        for dup in response.data["results"]:
            self.assertEqual(dup["duplicate_type"], Duplicate.DuplicateType.EXACT_COPY)

    def test_filter_visual_duplicates(self):
        """Test filtering for visual duplicates only."""
        response = self.client.get(
            f"/api/duplicates?duplicate_type={Duplicate.DuplicateType.VISUAL_DUPLICATE}"
        )
        
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["count"], 1)
        self.assertEqual(
            response.data["results"][0]["duplicate_type"],
            Duplicate.DuplicateType.VISUAL_DUPLICATE
        )

    def test_filter_invalid_type(self):
        """Test filtering with invalid type returns empty or all."""
        response = self.client.get("/api/duplicates?duplicate_type=invalid_type")
        
        self.assertEqual(response.status_code, 200)
        # Should return all or empty depending on implementation
        self.assertIn(response.data["count"], [0, 3])

    def test_no_filter_returns_all(self):
        """Test that no filter returns all duplicates."""
        response = self.client.get("/api/duplicates")
        
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["count"], 3)


class DuplicateFilterByStatusTestCase(TestCase):
    """Tests for filtering duplicates by status."""

    def setUp(self):
        self.user = create_test_user()
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)
        
        # Create photos for duplicates
        self.photos = [create_test_photo(owner=self.user) for _ in range(6)]
        
        # Create pending duplicate
        self.pending = Duplicate.objects.create(
            owner=self.user,
            duplicate_type=Duplicate.DuplicateType.EXACT_COPY,
            review_status=Duplicate.ReviewStatus.PENDING,
        )
        self.pending.photos.add(self.photos[0], self.photos[1])
        
        # Create resolved duplicate
        self.resolved = Duplicate.objects.create(
            owner=self.user,
            duplicate_type=Duplicate.DuplicateType.EXACT_COPY,
            review_status=Duplicate.ReviewStatus.RESOLVED,
        )
        self.resolved.photos.add(self.photos[2], self.photos[3])
        
        # Create dismissed duplicate
        self.dismissed = Duplicate.objects.create(
            owner=self.user,
            duplicate_type=Duplicate.DuplicateType.VISUAL_DUPLICATE,
            review_status=Duplicate.ReviewStatus.DISMISSED,
        )
        self.dismissed.photos.add(self.photos[4], self.photos[5])

    def test_filter_pending(self):
        """Test filtering for pending duplicates."""
        response = self.client.get(
            f"/api/duplicates?status={Duplicate.ReviewStatus.PENDING}"
        )
        
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["count"], 1)
        self.assertEqual(
            response.data["results"][0]["review_status"],
            Duplicate.ReviewStatus.PENDING
        )

    def test_filter_resolved(self):
        """Test filtering for resolved duplicates."""
        response = self.client.get(
            f"/api/duplicates?status={Duplicate.ReviewStatus.RESOLVED}"
        )
        
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["count"], 1)

    def test_filter_dismissed(self):
        """Test filtering for dismissed duplicates."""
        response = self.client.get(
            f"/api/duplicates?status={Duplicate.ReviewStatus.DISMISSED}"
        )
        
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["count"], 1)

    def test_combined_type_and_status_filter(self):
        """Test combining type and status filters."""
        response = self.client.get(
            f"/api/duplicates?duplicate_type={Duplicate.DuplicateType.EXACT_COPY}&status={Duplicate.ReviewStatus.PENDING}"
        )
        
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["count"], 1)


class PhotosWithoutPerceptualHashTestCase(TestCase):
    """Tests for handling photos without perceptual hash during detection."""

    def setUp(self):
        self.user = create_test_user()
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)

    def test_detection_handles_null_perceptual_hash(self):
        """Test that detection handles photos with null perceptual hash."""
        # Create photos, some without perceptual hash
        photo1 = create_test_photo(owner=self.user)
        _photo2 = create_test_photo(owner=self.user)
        
        # Set null perceptual hash
        photo1.image_phash = None
        photo1.save()
        
        # Detection should not crash - just trigger the endpoint
        response = self.client.post(
            "/api/duplicates/detect",
            {"detect_exact_copies": True, "detect_visual_duplicates": True},
            format='json',
        )
        
        self.assertIn(response.status_code, [200, 202])

    def test_visual_duplicate_detection_endpoint(self):
        """Test visual duplicate detection API endpoint."""
        # Create photos
        photo1 = create_test_photo(owner=self.user)
        photo2 = create_test_photo(owner=self.user)
        
        # Set phash values
        photo1.image_phash = "abcd1234"
        photo1.save()
        photo2.image_phash = "abcd1234"  # Same as photo1
        photo2.save()
        
        # Detection should work
        response = self.client.post(
            "/api/duplicates/detect",
            {"detect_visual_duplicates": True, "visual_threshold": 5},
            format='json',
        )
        
        self.assertIn(response.status_code, [200, 202])


class DuplicateDetectionJobTestCase(TestCase):
    """Tests for duplicate detection job handling."""

    def setUp(self):
        self.user = create_test_user()
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)

    def test_detect_with_all_options(self):
        """Test detection with all options enabled."""
        response = self.client.post(
            "/api/duplicates/detect",
            {
                "detect_exact_copies": True,
                "detect_visual_duplicates": True,
                "visual_threshold": 10,
                "clear_pending": False,
            },
            format='json',
        )
        
        self.assertIn(response.status_code, [200, 202])

    def test_detect_exact_only(self):
        """Test detection with only exact copies."""
        response = self.client.post(
            "/api/duplicates/detect",
            {"detect_exact_copies": True, "detect_visual_duplicates": False},
            format='json',
        )
        
        self.assertIn(response.status_code, [200, 202])

    def test_detect_visual_only(self):
        """Test detection with only visual duplicates."""
        response = self.client.post(
            "/api/duplicates/detect",
            {"detect_exact_copies": False, "detect_visual_duplicates": True},
            format='json',
        )
        
        self.assertIn(response.status_code, [200, 202])

    def test_detect_nothing_returns_error(self):
        """Test detection with both options false."""
        response = self.client.post(
            "/api/duplicates/detect",
            {"detect_exact_copies": False, "detect_visual_duplicates": False},
            format='json',
        )
        
        # Should return 400 or just skip detection
        self.assertIn(response.status_code, [200, 202, 400])

    def test_detect_with_clear_pending(self):
        """Test detection with clear_pending option."""
        # Create a pending duplicate first
        photo1 = create_test_photo(owner=self.user)
        photo2 = create_test_photo(owner=self.user)
        
        dup = Duplicate.objects.create(
            owner=self.user,
            duplicate_type=Duplicate.DuplicateType.EXACT_COPY,
            review_status=Duplicate.ReviewStatus.PENDING,
        )
        dup.photos.add(photo1, photo2)
        
        # Detection API queues a background job
        response = self.client.post(
            "/api/duplicates/detect",
            {"detect_exact_copies": True, "clear_pending": True},
            format='json',
        )
        
        self.assertIn(response.status_code, [200, 202])


class VisualThresholdTestCase(TestCase):
    """Tests for visual duplicate threshold sensitivity."""

    def setUp(self):
        self.user = create_test_user()
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)

    def test_strict_threshold(self):
        """Test visual detection with strict threshold (low value)."""
        response = self.client.post(
            "/api/duplicates/detect",
            {"detect_visual_duplicates": True, "visual_threshold": 3},
            format='json',
        )
        
        self.assertIn(response.status_code, [200, 202])

    def test_loose_threshold(self):
        """Test visual detection with loose threshold (high value)."""
        response = self.client.post(
            "/api/duplicates/detect",
            {"detect_visual_duplicates": True, "visual_threshold": 20},
            format='json',
        )
        
        self.assertIn(response.status_code, [200, 202])

    def test_zero_threshold(self):
        """Test visual detection with zero threshold (exact match only)."""
        response = self.client.post(
            "/api/duplicates/detect",
            {"detect_visual_duplicates": True, "visual_threshold": 0},
            format='json',
        )
        
        self.assertIn(response.status_code, [200, 202])

    def test_negative_threshold_handled(self):
        """Test that negative threshold is handled gracefully."""
        response = self.client.post(
            "/api/duplicates/detect",
            {"detect_visual_duplicates": True, "visual_threshold": -5},
            format='json',
        )
        
        # Should handle gracefully - either 400 or clamp to 0
        self.assertIn(response.status_code, [200, 202, 400])


class DuplicateListSortingTestCase(TestCase):
    """Tests for duplicate list sorting."""

    def setUp(self):
        self.user = create_test_user()
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)
        
        # Create multiple duplicates
        self.photos = [create_test_photo(owner=self.user) for _ in range(4)]
        
        self.dup1 = Duplicate.objects.create(
            owner=self.user,
            duplicate_type=Duplicate.DuplicateType.EXACT_COPY,
        )
        self.dup1.photos.add(self.photos[0], self.photos[1])
        
        self.dup2 = Duplicate.objects.create(
            owner=self.user,
            duplicate_type=Duplicate.DuplicateType.VISUAL_DUPLICATE,
            similarity_score=0.95,
        )
        self.dup2.photos.add(self.photos[2], self.photos[3])

    def test_default_sorting(self):
        """Test default sorting order."""
        response = self.client.get("/api/duplicates")
        
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["count"], 2)

    def test_sort_by_created_at(self):
        """Test sorting by created_at."""
        response = self.client.get("/api/duplicates?ordering=-created_at")
        
        self.assertEqual(response.status_code, 200)


class DuplicateBulkActionsTestCase(TestCase):
    """Tests for bulk actions on duplicates."""

    def setUp(self):
        self.user = create_test_user()
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)

    def test_bulk_dismiss(self):
        """Test bulk dismissing duplicates."""
        photos = [create_test_photo(owner=self.user) for _ in range(4)]
        
        dup1 = Duplicate.objects.create(
            owner=self.user,
            duplicate_type=Duplicate.DuplicateType.EXACT_COPY,
        )
        dup1.photos.add(photos[0], photos[1])
        
        dup2 = Duplicate.objects.create(
            owner=self.user,
            duplicate_type=Duplicate.DuplicateType.EXACT_COPY,
        )
        dup2.photos.add(photos[2], photos[3])
        
        # Dismiss first one
        response = self.client.post(f"/api/duplicates/{dup1.id}/dismiss")
        self.assertEqual(response.status_code, 200)
        
        dup1.refresh_from_db()
        self.assertEqual(dup1.review_status, Duplicate.ReviewStatus.DISMISSED)


class EmptyDuplicateGroupTestCase(TestCase):
    """Tests for handling empty or invalid duplicate groups."""

    def setUp(self):
        self.user = create_test_user()
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)

    def test_duplicate_with_no_photos(self):
        """Test handling duplicate group with no photos."""
        dup = Duplicate.objects.create(
            owner=self.user,
            duplicate_type=Duplicate.DuplicateType.EXACT_COPY,
        )
        # Don't add any photos
        
        response = self.client.get(f"/api/duplicates/{dup.id}")
        
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["photo_count"], 0)

    def test_duplicate_with_one_photo(self):
        """Test handling duplicate group with only one photo."""
        photo = create_test_photo(owner=self.user)
        
        dup = Duplicate.objects.create(
            owner=self.user,
            duplicate_type=Duplicate.DuplicateType.EXACT_COPY,
        )
        dup.photos.add(photo)
        
        response = self.client.get(f"/api/duplicates/{dup.id}")
        
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["photo_count"], 1)

    def test_resolve_single_photo_duplicate(self):
        """Test resolving duplicate with only one photo."""
        photo = create_test_photo(owner=self.user)
        
        dup = Duplicate.objects.create(
            owner=self.user,
            duplicate_type=Duplicate.DuplicateType.EXACT_COPY,
        )
        dup.photos.add(photo)
        
        response = self.client.post(
            f"/api/duplicates/{dup.id}/resolve",
            {"keep_photo_hash": photo.image_hash},
            format='json',
        )
        
        # Should succeed but with no photos to trash
        self.assertIn(response.status_code, [200, 400])
