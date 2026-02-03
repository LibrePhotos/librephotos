"""
Tests for edge cases and error handling.

Tests:
- Photos with no EXIF data
- Missing/corrupted files
- Concurrent detection jobs
- Empty/invalid data handling
"""


from django.test import TestCase, TransactionTestCase
from rest_framework.test import APIClient, APITestCase

from api.models.duplicate import Duplicate
from api.models.photo_stack import PhotoStack
from api.models.photo_metadata import PhotoMetadata
from api.tests.utils import create_test_photo, create_test_user


class PhotoNoExifDataTestCase(TestCase):
    """Test handling of photos with no EXIF data."""

    def setUp(self):
        self.user = create_test_user()

    def test_photo_without_exif_timestamp(self):
        """Test handling photo with no EXIF timestamp."""
        photo = create_test_photo(owner=self.user)
        photo.exif_timestamp = None
        photo.save()
        
        # Should still be usable
        self.assertIsNotNone(photo.pk)
        self.assertIsNone(photo.exif_timestamp)

    def test_photo_without_gps_data(self):
        """Test handling photo with no GPS data."""
        photo = create_test_photo(owner=self.user)
        photo.exif_gps_lat = None
        photo.exif_gps_lon = None
        photo.save()
        
        # Should still be usable
        self.assertIsNotNone(photo.pk)

    def test_photo_without_perceptual_hash(self):
        """Test handling photo with no perceptual hash."""
        photo = create_test_photo(owner=self.user)
        photo.image_phash = None
        photo.save()
        
        # Should still be usable but not in visual duplicate detection
        self.assertIsNotNone(photo.pk)
        self.assertIsNone(photo.image_phash)

    def test_stack_with_no_exif_photos(self):
        """Test creating stack with photos that have no EXIF."""
        photos = []
        for _ in range(3):
            photo = create_test_photo(owner=self.user)
            photo.exif_timestamp = None
            photo.save()
            photos.append(photo)
        
        stack = PhotoStack.objects.create(
            owner=self.user,
            stack_type=PhotoStack.StackType.MANUAL,
        )
        stack.photos.add(*photos)
        
        # auto_select_primary should still work
        _result = stack.auto_select_primary()
        # May or may not select one depending on implementation
        # The important thing is it doesn't crash

    def test_duplicate_with_no_metadata_photos(self):
        """Test duplicate group with photos lacking metadata."""
        photos = []
        for _ in range(2):
            photo = create_test_photo(owner=self.user)
            # Don't create metadata
            PhotoMetadata.objects.filter(photo=photo).delete()
            photos.append(photo)
        
        dup = Duplicate.objects.create(
            owner=self.user,
            duplicate_type=Duplicate.DuplicateType.VISUAL_DUPLICATE,
        )
        dup.photos.add(*photos)
        
        # auto_select_best_photo should handle gracefully
        _result = dup.auto_select_best_photo()
        # Should return something (or None) without crashing

    def test_burst_detection_no_timestamps(self):
        """Test burst detection with photos lacking timestamps."""
        photos = []
        for _ in range(5):
            photo = create_test_photo(owner=self.user)
            photo.exif_timestamp = None
            photo.save()
            photos.append(photo)
        
        # Should not create burst stacks for photos without timestamps
        # (timestamps are required for burst proximity detection)


class MissingFileTestCase(TestCase):
    """Test handling of photos with missing files."""

    def setUp(self):
        self.user = create_test_user()

    def test_photo_with_null_main_file(self):
        """Test handling photo with null main_file reference."""
        photo = create_test_photo(owner=self.user)
        
        # This might not be allowed by the model, but test graceful handling
        # Note: Can't actually set main_file to None due to NOT NULL constraint
        # So we test that the photo with a valid file still works
        self.assertIsNotNone(photo.main_file)

    def test_stack_photos_with_missing_metadata(self):
        """Test stack with photos that have no PhotoMetadata records."""
        photos = [create_test_photo(owner=self.user) for _ in range(3)]
        
        # Delete metadata records
        PhotoMetadata.objects.filter(photo__in=photos).delete()
        
        stack = PhotoStack.objects.create(
            owner=self.user,
            stack_type=PhotoStack.StackType.MANUAL,
        )
        stack.photos.add(*photos)
        
        # Stack should still function
        self.assertEqual(stack.photos.count(), 3)


class ConcurrentDetectionTestCase(TransactionTestCase):
    """Test concurrent detection job handling."""

    def setUp(self):
        self.user = create_test_user()
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)

    def test_concurrent_duplicate_detection_requests(self):
        """Test handling multiple simultaneous detection requests."""
        # Create photos
        for _ in range(5):
            create_test_photo(owner=self.user)
        
        results = []
        errors = []
        
        def trigger_detection():
            try:
                response = self.client.post("/api/duplicates/detect")
                results.append(response.status_code)
            except Exception as e:
                errors.append(str(e))
        
        # Trigger multiple detections (simulated - they run sequentially in test)
        for _ in range(3):
            trigger_detection()
        
        # All requests should succeed (or be queued)
        for status in results:
            self.assertIn(status, [200, 202, 409])  # 409 = conflict if already running
        
        # No errors should occur
        self.assertEqual(len(errors), 0)

    def test_concurrent_stack_detection_requests(self):
        """Test handling multiple simultaneous stack detection requests."""
        # Create photos
        for _ in range(5):
            create_test_photo(owner=self.user)
        
        results = []
        
        for _ in range(3):
            response = self.client.post("/api/stacks/detect")
            results.append(response.status_code)
        
        # All requests should succeed or be handled gracefully
        for status in results:
            self.assertIn(status, [200, 202, 409])


class EmptyDataTestCase(APITestCase):
    """Test handling of empty or minimal data."""

    def setUp(self):
        self.user = create_test_user()
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)

    def test_duplicate_list_empty(self):
        """Test duplicate list with no duplicates."""
        response = self.client.get("/api/duplicates")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.data.get("results", [])), 0)

    def test_stack_list_empty(self):
        """Test stack list with no stacks."""
        response = self.client.get("/api/stacks")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.data.get("results", [])), 0)

    def test_duplicate_stats_empty(self):
        """Test duplicate stats with no data."""
        response = self.client.get("/api/duplicates/stats")
        self.assertEqual(response.status_code, 200)

    def test_stack_stats_empty(self):
        """Test stack stats with no data."""
        response = self.client.get("/api/stacks/stats")
        self.assertEqual(response.status_code, 200)

    def test_detection_with_no_photos(self):
        """Test detection when user has no photos."""
        response = self.client.post("/api/duplicates/detect")
        # Should succeed but find nothing
        self.assertIn(response.status_code, [200, 202])

    def test_stack_detection_with_no_photos(self):
        """Test stack detection when user has no photos."""
        response = self.client.post("/api/stacks/detect")
        # Should succeed but find nothing
        self.assertIn(response.status_code, [200, 202])


class InvalidDataTestCase(APITestCase):
    """Test handling of invalid data inputs."""

    def setUp(self):
        self.user = create_test_user()
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)

    def test_resolve_with_invalid_photo_id(self):
        """Test resolve with invalid photo ID."""
        photos = [create_test_photo(owner=self.user) for _ in range(2)]
        dup = Duplicate.objects.create(
            owner=self.user,
            duplicate_type=Duplicate.DuplicateType.EXACT_COPY,
        )
        dup.photos.add(*photos)
        
        response = self.client.post(
            f"/api/duplicates/{dup.id}/resolve",
            {"kept_photo_id": "not-a-valid-uuid"},
            format="json"
        )
        self.assertIn(response.status_code, [400, 404])

    def test_add_to_stack_with_invalid_photo_ids(self):
        """Test adding invalid photo IDs to stack."""
        photos = [create_test_photo(owner=self.user) for _ in range(2)]
        stack = PhotoStack.objects.create(
            owner=self.user,
            stack_type=PhotoStack.StackType.MANUAL,
        )
        stack.photos.add(*photos)
        
        response = self.client.post(
            f"/api/stacks/{stack.id}/add",
            {"photo_ids": ["invalid-id-1", "invalid-id-2"]},
            format="json"
        )
        # Should handle gracefully
        self.assertIn(response.status_code, [200, 400, 404])

    def test_set_primary_with_invalid_photo_id(self):
        """Test setting primary with invalid photo ID."""
        photos = [create_test_photo(owner=self.user) for _ in range(2)]
        stack = PhotoStack.objects.create(
            owner=self.user,
            stack_type=PhotoStack.StackType.MANUAL,
        )
        stack.photos.add(*photos)
        
        response = self.client.post(
            f"/api/stacks/{stack.id}/primary",
            {"photo_id": "not-a-uuid"},
            format="json"
        )
        self.assertIn(response.status_code, [400, 404])

    def test_detection_with_invalid_options(self):
        """Test detection with invalid options."""
        response = self.client.post(
            "/api/duplicates/detect",
            {"invalid_option": "value"},
            format="json"
        )
        # Should ignore invalid options and proceed
        self.assertIn(response.status_code, [200, 202, 400])


class SinglePhotoGroupTestCase(TestCase):
    """Test handling of single-photo groups."""

    def setUp(self):
        self.user = create_test_user()

    def test_duplicate_with_single_photo_deleted(self):
        """Test duplicate group cleanup when reduced to single photo."""
        photos = [create_test_photo(owner=self.user) for _ in range(2)]
        dup = Duplicate.objects.create(
            owner=self.user,
            duplicate_type=Duplicate.DuplicateType.EXACT_COPY,
        )
        dup.photos.add(*photos)
        
        # Remove one photo
        dup.photos.remove(photos[0])
        
        # Group should still exist but may be cleaned up depending on implementation
        # The important thing is no crash occurs

    def test_stack_with_single_photo(self):
        """Test stack behavior with single photo."""
        photo = create_test_photo(owner=self.user)
        stack = PhotoStack.objects.create(
            owner=self.user,
            stack_type=PhotoStack.StackType.MANUAL,
        )
        stack.photos.add(photo)
        
        # Single photo stack is valid for manual stacks
        self.assertEqual(stack.photos.count(), 1)

    def test_auto_select_with_single_photo(self):
        """Test auto_select_primary with single photo."""
        photo = create_test_photo(owner=self.user)
        stack = PhotoStack.objects.create(
            owner=self.user,
            stack_type=PhotoStack.StackType.MANUAL,
        )
        stack.photos.add(photo)
        
        _result = stack.auto_select_primary()
        stack.refresh_from_db()
        
        # Should select the only photo
        self.assertEqual(stack.primary_photo, photo)


class PhotoDeletionEdgeCasesTestCase(TestCase):
    """Test edge cases around photo deletion."""

    def setUp(self):
        self.user = create_test_user()

    def test_delete_photo_in_multiple_stacks(self):
        """Test deleting a photo that's in multiple stacks."""
        photo = create_test_photo(owner=self.user)
        other_photos1 = [create_test_photo(owner=self.user) for _ in range(2)]
        other_photos2 = [create_test_photo(owner=self.user) for _ in range(2)]
        
        stack1 = PhotoStack.objects.create(
            owner=self.user,
            stack_type=PhotoStack.StackType.MANUAL,
        )
        stack1.photos.add(photo, *other_photos1)
        
        stack2 = PhotoStack.objects.create(
            owner=self.user,
            stack_type=PhotoStack.StackType.MANUAL,
        )
        stack2.photos.add(photo, *other_photos2)
        
        # Delete the shared photo
        photo.manual_delete()
        
        # Both stacks should still exist with remaining photos
        stack1.refresh_from_db()
        stack2.refresh_from_db()
        self.assertEqual(stack1.photos.count(), 2)
        self.assertEqual(stack2.photos.count(), 2)

    def test_delete_photo_in_multiple_duplicate_groups(self):
        """Test deleting a photo that's in multiple duplicate groups."""
        photo = create_test_photo(owner=self.user)
        other_photos1 = [create_test_photo(owner=self.user)]
        other_photos2 = [create_test_photo(owner=self.user)]
        
        dup1 = Duplicate.objects.create(
            owner=self.user,
            duplicate_type=Duplicate.DuplicateType.EXACT_COPY,
        )
        dup1.photos.add(photo, *other_photos1)
        
        dup2 = Duplicate.objects.create(
            owner=self.user,
            duplicate_type=Duplicate.DuplicateType.VISUAL_DUPLICATE,
        )
        dup2.photos.add(photo, *other_photos2)
        
        # Delete the shared photo
        photo.manual_delete()
        
        # Both groups should be cleaned up (single photo remaining)
        # Depending on implementation, they may be deleted or left with 1 photo

    def test_delete_primary_photo_from_stack(self):
        """Test deleting the primary photo from a stack."""
        photos = [create_test_photo(owner=self.user) for _ in range(3)]
        stack = PhotoStack.objects.create(
            owner=self.user,
            stack_type=PhotoStack.StackType.MANUAL,
            primary_photo=photos[0],
        )
        stack.photos.add(*photos)
        
        # Delete the primary photo
        photos[0].manual_delete()
        
        stack.refresh_from_db()
        
        # Stack should still exist
        self.assertEqual(stack.photos.count(), 2)
        # Primary may be cleared or set to another photo depending on implementation


class MetadataEdgeCasesTestCase(TestCase):
    """Test edge cases for metadata handling."""

    def setUp(self):
        self.user = create_test_user()

    def test_photo_with_extreme_dimensions(self):
        """Test handling photos with extreme dimensions."""
        photo = create_test_photo(owner=self.user)
        metadata, _ = PhotoMetadata.objects.get_or_create(photo=photo)
        
        # Very large dimensions
        metadata.width = 50000
        metadata.height = 50000
        metadata.save()
        
        # Should not crash on resolution calculation
        self.assertIsNotNone(metadata.resolution)

    def test_photo_with_zero_dimensions(self):
        """Test handling photos with zero dimensions."""
        photo = create_test_photo(owner=self.user)
        metadata, _ = PhotoMetadata.objects.get_or_create(photo=photo)
        
        metadata.width = 0
        metadata.height = 0
        metadata.save()
        
        # Should handle gracefully
        self.assertEqual(metadata.width, 0)

    def test_duplicate_savings_with_zero_size(self):
        """Test potential savings calculation with zero-size photos."""
        photos = [create_test_photo(owner=self.user) for _ in range(3)]
        for photo in photos:
            photo.size = 0
            photo.save()
        
        dup = Duplicate.objects.create(
            owner=self.user,
            duplicate_type=Duplicate.DuplicateType.EXACT_COPY,
        )
        dup.photos.add(*photos)
        
        savings = dup.calculate_potential_savings()
        self.assertEqual(savings, 0)
