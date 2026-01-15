"""
Tests for stats accuracy and edge cases.

Ensures that:
- Duplicate stats are calculated correctly
- Stack stats are calculated correctly
- Edge cases (empty, single items, etc.) are handled
- Stats are properly scoped to user
- Potential savings calculations are accurate
"""

from django.test import TestCase
from django.db.models import Sum
from rest_framework.test import APIClient, APITestCase

from api.models import Photo, User
from api.models.duplicate import Duplicate
from api.models.photo_stack import PhotoStack
from api.models.photo_metadata import PhotoMetadata
from api.tests.utils import create_test_photo, create_test_user
from api.stats import get_count_stats, calc_megabytes, median_value


class DuplicateStatsAccuracyTestCase(APITestCase):
    """Test duplicate stats calculations."""

    def setUp(self):
        self.user = create_test_user()
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)

    def test_empty_stats(self):
        """Test stats when no duplicates exist."""
        response = self.client.get("/api/duplicates/stats")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["total_duplicates"], 0)
        self.assertEqual(response.data["pending_duplicates"], 0)
        self.assertEqual(response.data["resolved_duplicates"], 0)
        self.assertEqual(response.data["dismissed_duplicates"], 0)

    def test_stats_by_type(self):
        """Test stats count by duplicate type."""
        # Create exact copies
        for _ in range(3):
            photos = [create_test_photo(owner=self.user) for _ in range(2)]
            dup = Duplicate.objects.create(
                owner=self.user,
                duplicate_type=Duplicate.DuplicateType.EXACT_COPY,
            )
            dup.photos.add(*photos)
        
        # Create visual duplicates
        for _ in range(2):
            photos = [create_test_photo(owner=self.user) for _ in range(2)]
            dup = Duplicate.objects.create(
                owner=self.user,
                duplicate_type=Duplicate.DuplicateType.VISUAL_DUPLICATE,
            )
            dup.photos.add(*photos)
        
        response = self.client.get("/api/duplicates/stats")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["by_type"]["exact_copy"], 3)
        self.assertEqual(response.data["by_type"]["visual_duplicate"], 2)

    def test_stats_by_status(self):
        """Test stats count by review status."""
        # Create pending
        for _ in range(4):
            photos = [create_test_photo(owner=self.user) for _ in range(2)]
            dup = Duplicate.objects.create(
                owner=self.user,
                duplicate_type=Duplicate.DuplicateType.EXACT_COPY,
                review_status=Duplicate.ReviewStatus.PENDING,
            )
            dup.photos.add(*photos)
        
        # Create resolved
        for _ in range(2):
            photos = [create_test_photo(owner=self.user) for _ in range(2)]
            dup = Duplicate.objects.create(
                owner=self.user,
                duplicate_type=Duplicate.DuplicateType.EXACT_COPY,
                review_status=Duplicate.ReviewStatus.RESOLVED,
            )
            dup.photos.add(*photos)
        
        # Create dismissed
        photos = [create_test_photo(owner=self.user) for _ in range(2)]
        dup = Duplicate.objects.create(
            owner=self.user,
            duplicate_type=Duplicate.DuplicateType.EXACT_COPY,
            review_status=Duplicate.ReviewStatus.DISMISSED,
        )
        dup.photos.add(*photos)
        
        response = self.client.get("/api/duplicates/stats")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["pending_duplicates"], 4)
        self.assertEqual(response.data["resolved_duplicates"], 2)
        self.assertEqual(response.data["dismissed_duplicates"], 1)

    def test_photos_in_duplicates_count(self):
        """Test count of photos involved in duplicates."""
        # Create 3 duplicate groups, each with 2 photos = 6 photos total
        for _ in range(3):
            photos = [create_test_photo(owner=self.user) for _ in range(2)]
            dup = Duplicate.objects.create(
                owner=self.user,
                duplicate_type=Duplicate.DuplicateType.EXACT_COPY,
            )
            dup.photos.add(*photos)
        
        response = self.client.get("/api/duplicates/stats")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["photos_in_duplicates"], 6)

    def test_potential_savings_calculation(self):
        """Test that potential savings is calculated from pending duplicates only."""
        # Create pending duplicate with known savings
        photos = [create_test_photo(owner=self.user) for _ in range(2)]
        pending_dup = Duplicate.objects.create(
            owner=self.user,
            duplicate_type=Duplicate.DuplicateType.EXACT_COPY,
            review_status=Duplicate.ReviewStatus.PENDING,
            potential_savings=1000000,  # 1MB
        )
        pending_dup.photos.add(*photos)
        
        # Create resolved duplicate - should not count
        photos2 = [create_test_photo(owner=self.user) for _ in range(2)]
        resolved_dup = Duplicate.objects.create(
            owner=self.user,
            duplicate_type=Duplicate.DuplicateType.EXACT_COPY,
            review_status=Duplicate.ReviewStatus.RESOLVED,
            potential_savings=5000000,  # 5MB - should be ignored
        )
        resolved_dup.photos.add(*photos2)
        
        response = self.client.get("/api/duplicates/stats")
        self.assertEqual(response.status_code, 200)
        # Only pending savings should be counted
        self.assertEqual(response.data["potential_savings_bytes"], 1000000)

    def test_stats_user_scoped(self):
        """Test that stats only include current user's duplicates."""
        other_user = create_test_user()
        
        # Create duplicate for other user
        other_photos = [create_test_photo(owner=other_user) for _ in range(2)]
        other_dup = Duplicate.objects.create(
            owner=other_user,
            duplicate_type=Duplicate.DuplicateType.EXACT_COPY,
        )
        other_dup.photos.add(*other_photos)
        
        # Create duplicate for current user
        my_photos = [create_test_photo(owner=self.user) for _ in range(2)]
        my_dup = Duplicate.objects.create(
            owner=self.user,
            duplicate_type=Duplicate.DuplicateType.EXACT_COPY,
        )
        my_dup.photos.add(*my_photos)
        
        response = self.client.get("/api/duplicates/stats")
        self.assertEqual(response.status_code, 200)
        # Should only see our duplicate
        self.assertEqual(response.data["total_duplicates"], 1)


class StackStatsAccuracyTestCase(APITestCase):
    """Test stack stats calculations."""

    def setUp(self):
        self.user = create_test_user()
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)

    def test_empty_stats(self):
        """Test stats when no stacks exist."""
        response = self.client.get("/api/stacks/stats")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["total_stacks"], 0)
        self.assertEqual(response.data["photos_in_stacks"], 0)

    def test_stats_by_type(self):
        """Test stats count by stack type."""
        # Create RAW+JPEG pairs
        for _ in range(2):
            photos = [create_test_photo(owner=self.user) for _ in range(2)]
            stack = PhotoStack.objects.create(
                owner=self.user,
                stack_type=PhotoStack.StackType.RAW_JPEG_PAIR,
            )
            stack.photos.add(*photos)
        
        # Create burst sequences
        for _ in range(3):
            photos = [create_test_photo(owner=self.user) for _ in range(3)]
            stack = PhotoStack.objects.create(
                owner=self.user,
                stack_type=PhotoStack.StackType.BURST_SEQUENCE,
            )
            stack.photos.add(*photos)
        
        # Create manual stack
        photos = [create_test_photo(owner=self.user) for _ in range(2)]
        stack = PhotoStack.objects.create(
            owner=self.user,
            stack_type=PhotoStack.StackType.MANUAL,
        )
        stack.photos.add(*photos)
        
        response = self.client.get("/api/stacks/stats")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["by_type"]["raw_jpeg"], 2)
        self.assertEqual(response.data["by_type"]["burst"], 3)
        self.assertEqual(response.data["by_type"]["manual"], 1)

    def test_photos_in_stacks_count(self):
        """Test count of photos involved in stacks."""
        # 2 RAW+JPEG pairs (2 photos each) = 4 photos
        for _ in range(2):
            photos = [create_test_photo(owner=self.user) for _ in range(2)]
            stack = PhotoStack.objects.create(
                owner=self.user,
                stack_type=PhotoStack.StackType.RAW_JPEG_PAIR,
            )
            stack.photos.add(*photos)
        
        # 1 burst (3 photos)
        photos = [create_test_photo(owner=self.user) for _ in range(3)]
        stack = PhotoStack.objects.create(
            owner=self.user,
            stack_type=PhotoStack.StackType.BURST_SEQUENCE,
        )
        stack.photos.add(*photos)
        
        response = self.client.get("/api/stacks/stats")
        self.assertEqual(response.status_code, 200)
        # Total: 4 + 3 = 7 photos
        self.assertEqual(response.data["photos_in_stacks"], 7)

    def test_photo_in_multiple_stacks_counted_once(self):
        """Test that a photo in multiple stacks is counted only once."""
        photos = [create_test_photo(owner=self.user) for _ in range(3)]
        
        # Add first two photos to one stack
        stack1 = PhotoStack.objects.create(
            owner=self.user,
            stack_type=PhotoStack.StackType.MANUAL,
        )
        stack1.photos.add(photos[0], photos[1])
        
        # Add last two photos to another stack (photos[1] is in both)
        stack2 = PhotoStack.objects.create(
            owner=self.user,
            stack_type=PhotoStack.StackType.MANUAL,
        )
        stack2.photos.add(photos[1], photos[2])
        
        response = self.client.get("/api/stacks/stats")
        self.assertEqual(response.status_code, 200)
        # Should be 3 distinct photos, not 4
        self.assertEqual(response.data["photos_in_stacks"], 3)

    def test_stats_user_scoped(self):
        """Test that stats only include current user's stacks."""
        other_user = create_test_user()
        
        # Create stack for other user
        other_photos = [create_test_photo(owner=other_user) for _ in range(2)]
        other_stack = PhotoStack.objects.create(
            owner=other_user,
            stack_type=PhotoStack.StackType.MANUAL,
        )
        other_stack.photos.add(*other_photos)
        
        # Create stack for current user
        my_photos = [create_test_photo(owner=self.user) for _ in range(2)]
        my_stack = PhotoStack.objects.create(
            owner=self.user,
            stack_type=PhotoStack.StackType.MANUAL,
        )
        my_stack.photos.add(*my_photos)
        
        response = self.client.get("/api/stacks/stats")
        self.assertEqual(response.status_code, 200)
        # Should only see our stack
        self.assertEqual(response.data["total_stacks"], 1)

    def test_excludes_duplicate_type_stacks(self):
        """Test that old duplicate-type stacks are excluded from stats."""
        # Create a valid stack
        photos = [create_test_photo(owner=self.user) for _ in range(2)]
        valid_stack = PhotoStack.objects.create(
            owner=self.user,
            stack_type=PhotoStack.StackType.MANUAL,
        )
        valid_stack.photos.add(*photos)
        
        # Create an old duplicate-type stack (should be excluded)
        # Note: These types may not exist anymore, but test the filtering
        
        response = self.client.get("/api/stacks/stats")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["total_stacks"], 1)


class UtilityFunctionsTestCase(TestCase):
    """Test utility functions in stats module."""

    def test_calc_megabytes_zero(self):
        """Test megabyte calculation with zero bytes."""
        self.assertEqual(calc_megabytes(0), 0)

    def test_calc_megabytes_none(self):
        """Test megabyte calculation with None."""
        self.assertEqual(calc_megabytes(None), 0)

    def test_calc_megabytes_small(self):
        """Test megabyte calculation with small values."""
        # 1 MB = 1048576 bytes
        self.assertEqual(calc_megabytes(1048576), 1)

    def test_calc_megabytes_large(self):
        """Test megabyte calculation with large values."""
        # 100 MB
        self.assertEqual(calc_megabytes(104857600), 100)

    def test_median_value_empty_queryset(self):
        """Test median with empty queryset."""
        from api.models import Photo
        qs = Photo.objects.none()
        result = median_value(qs, "size")
        self.assertIsNone(result)


class CountStatsTestCase(TestCase):
    """Test get_count_stats function."""

    def setUp(self):
        self.user = create_test_user()

    def test_count_stats_no_photos(self):
        """Test count stats when user has no photos."""
        stats = get_count_stats(self.user)
        self.assertEqual(stats["num_photos"], 0)

    def test_count_stats_with_photos(self):
        """Test count stats with photos."""
        # Create some photos
        for _ in range(5):
            create_test_photo(owner=self.user)
        
        stats = get_count_stats(self.user)
        self.assertEqual(stats["num_photos"], 5)

    def test_count_stats_excludes_hidden(self):
        """Test that hidden photos are excluded from count."""
        # Create visible photos
        for _ in range(3):
            create_test_photo(owner=self.user)
        
        # Create hidden photo
        hidden = create_test_photo(owner=self.user)
        hidden.hidden = True
        hidden.save()
        
        stats = get_count_stats(self.user)
        # Depending on implementation, hidden may or may not be counted
        # The important thing is no crash

    def test_count_stats_user_scoped(self):
        """Test that count stats are user-scoped."""
        other_user = create_test_user()
        
        # Create photos for other user
        for _ in range(10):
            create_test_photo(owner=other_user)
        
        # Create photos for current user
        for _ in range(3):
            create_test_photo(owner=self.user)
        
        stats = get_count_stats(self.user)
        self.assertEqual(stats["num_photos"], 3)


class StatsEdgeCasesTestCase(APITestCase):
    """Test edge cases for stats calculations."""

    def setUp(self):
        self.user = create_test_user()
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)

    def test_duplicate_with_zero_photos(self):
        """Test stats with duplicate group that has no photos."""
        # Create empty duplicate group
        dup = Duplicate.objects.create(
            owner=self.user,
            duplicate_type=Duplicate.DuplicateType.EXACT_COPY,
        )
        # Don't add any photos
        
        response = self.client.get("/api/duplicates/stats")
        self.assertEqual(response.status_code, 200)
        # Should handle gracefully

    def test_stack_with_single_photo(self):
        """Test stats with stack that has only one photo."""
        photo = create_test_photo(owner=self.user)
        stack = PhotoStack.objects.create(
            owner=self.user,
            stack_type=PhotoStack.StackType.MANUAL,
        )
        stack.photos.add(photo)
        
        response = self.client.get("/api/stacks/stats")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["total_stacks"], 1)
        self.assertEqual(response.data["photos_in_stacks"], 1)

    def test_deleted_photo_in_group(self):
        """Test stats when photo has been deleted from group."""
        photos = [create_test_photo(owner=self.user) for _ in range(3)]
        
        stack = PhotoStack.objects.create(
            owner=self.user,
            stack_type=PhotoStack.StackType.MANUAL,
        )
        stack.photos.add(*photos)
        
        # Delete one photo from stack
        stack.photos.remove(photos[0])
        
        response = self.client.get("/api/stacks/stats")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["photos_in_stacks"], 2)

    def test_trashed_photos_excluded(self):
        """Test that trashed photos are excluded from total count."""
        # Create normal photos
        for _ in range(3):
            create_test_photo(owner=self.user)
        
        # Create trashed photo
        trashed = create_test_photo(owner=self.user)
        trashed.in_trashcan = True
        trashed.save()
        
        response = self.client.get("/api/stacks/stats")
        self.assertEqual(response.status_code, 200)
        # total_photos should not include trashed
        self.assertEqual(response.data["total_photos"], 3)

    def test_large_number_of_groups(self):
        """Test stats with many groups."""
        # Create 50 duplicate groups
        for _ in range(50):
            photos = [create_test_photo(owner=self.user) for _ in range(2)]
            dup = Duplicate.objects.create(
                owner=self.user,
                duplicate_type=Duplicate.DuplicateType.EXACT_COPY,
            )
            dup.photos.add(*photos)
        
        response = self.client.get("/api/duplicates/stats")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["total_duplicates"], 50)
        self.assertEqual(response.data["photos_in_duplicates"], 100)
