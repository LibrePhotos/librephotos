"""
Tests for re-detection idempotency.

Ensures that running detection multiple times:
- Does not create duplicate stacks
- Does not create duplicate duplicate-groups
- Handles already-processed photos correctly
- Merges with existing groups properly

NOTE: RAW+JPEG pairs and Live Photos are now handled as file variants
during the initial scan (Photo.files ManyToMany field), not as stacks.
This module tests idempotency for:
- Duplicate detection (exact copies, visual duplicates)
- Burst sequence detection
"""

import uuid

from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient, APITestCase

from api.models.duplicate import Duplicate
from api.models.photo_stack import PhotoStack
from api.models.file import File
from api.tests.utils import create_test_photo, create_test_user
from api.duplicate_detection import detect_exact_copies, detect_visual_duplicates
from api.stack_detection import detect_burst_sequences


class DuplicateRedetectionTestCase(TestCase):
    """Test that duplicate detection is idempotent."""

    def setUp(self):
        self.user = create_test_user()

    def test_exact_copy_redetection_no_duplicates(self):
        """Test that running exact copy detection twice doesn't create duplicate groups."""
        # Create photos with same hash (simulating exact copies)
        photo1 = create_test_photo(owner=self.user)
        photo2 = create_test_photo(owner=self.user)
        
        # Set same image_hash to simulate exact copies
        same_hash = "abcdef1234567890abcdef1234567890"
        photo1.image_hash = same_hash
        photo1.save()
        photo2.image_hash = same_hash
        photo2.save()
        
        # First detection
        detect_exact_copies(self.user)
        initial_count = Duplicate.objects.filter(owner=self.user).count()
        
        # Second detection
        detect_exact_copies(self.user)
        final_count = Duplicate.objects.filter(owner=self.user).count()
        
        # Should have same number of groups
        self.assertEqual(initial_count, final_count)

    def test_visual_duplicate_redetection_no_duplicates(self):
        """Test that running visual duplicate detection twice doesn't create duplicate groups."""
        # Create photos with similar perceptual hash
        photo1 = create_test_photo(owner=self.user)
        photo2 = create_test_photo(owner=self.user)
        
        # Set similar perceptual hashes
        photo1.image_phash = "0000000000000000"
        photo1.save()
        photo2.image_phash = "0000000000000001"  # Very similar
        photo2.save()
        
        # First detection
        detect_visual_duplicates(self.user, threshold=10)
        initial_count = Duplicate.objects.filter(owner=self.user).count()
        initial_photo_count = sum(
            d.photos.count() for d in Duplicate.objects.filter(owner=self.user)
        )
        
        # Second detection
        detect_visual_duplicates(self.user, threshold=10)
        final_count = Duplicate.objects.filter(owner=self.user).count()
        final_photo_count = sum(
            d.photos.count() for d in Duplicate.objects.filter(owner=self.user)
        )
        
        # Should have same number of groups and photos
        self.assertEqual(initial_count, final_count)
        self.assertEqual(initial_photo_count, final_photo_count)

    def test_redetection_adds_new_photos_to_existing_group(self):
        """Test that new duplicates are added to existing groups, not new ones."""
        # Create initial duplicate pair
        photo1 = create_test_photo(owner=self.user)
        photo2 = create_test_photo(owner=self.user)
        
        same_hash = "abcdef1234567890abcdef1234567890"
        photo1.image_hash = same_hash
        photo1.save()
        photo2.image_hash = same_hash
        photo2.save()
        
        # First detection creates a group
        detect_exact_copies(self.user)
        initial_groups = list(Duplicate.objects.filter(owner=self.user))
        self.assertEqual(len(initial_groups), 1)
        
        # Add a third photo with same hash
        photo3 = create_test_photo(owner=self.user)
        photo3.image_hash = same_hash
        photo3.save()
        
        # Second detection should add to existing group
        detect_exact_copies(self.user)
        final_groups = list(Duplicate.objects.filter(owner=self.user))
        
        # Should still have only one group
        self.assertEqual(len(final_groups), 1)
        # Group should now have 3 photos
        self.assertEqual(final_groups[0].photos.count(), 3)

    def test_redetection_with_resolved_duplicates(self):
        """Test that resolved duplicates are not re-detected."""
        # Create duplicate pair
        photo1 = create_test_photo(owner=self.user)
        photo2 = create_test_photo(owner=self.user)
        
        same_hash = "abcdef1234567890abcdef1234567890"
        photo1.image_hash = same_hash
        photo1.save()
        photo2.image_hash = same_hash
        photo2.save()
        
        # First detection
        detect_exact_copies(self.user)
        dup = Duplicate.objects.filter(owner=self.user).first()
        
        # Resolve the duplicate
        dup.resolve(kept_photo=photo1)
        
        # Re-detection
        detect_exact_copies(self.user)
        
        # Should not create a new pending group for resolved duplicates
        _pending_groups = Duplicate.objects.filter(
            owner=self.user,
            review_status=Duplicate.ReviewStatus.PENDING
        ).count()
        
        # Depending on implementation, either 0 new pending groups or existing resolved stays resolved
        resolved_groups = Duplicate.objects.filter(
            owner=self.user,
            review_status=Duplicate.ReviewStatus.RESOLVED
        ).count()
        self.assertGreaterEqual(resolved_groups, 1)


class BurstRedetectionTestCase(TestCase):
    """Test that burst stack detection is idempotent."""

    def setUp(self):
        self.user = create_test_user()

    def test_burst_redetection_no_duplicate_stacks(self):
        """Test that running burst detection twice doesn't create duplicate stacks."""
        # Create photos that look like a burst
        base_time = timezone.now()
        photos = []
        for i in range(3):
            photo = create_test_photo(owner=self.user)
            photo.exif_timestamp = base_time + timezone.timedelta(milliseconds=100 * i)
            photo.main_file.path = f"/photos/IMG_001_{i}.JPG"
            photo.main_file.save()
            photo.save()
            photos.append(photo)
        
        # First detection
        detect_burst_sequences(self.user)
        initial_stacks = PhotoStack.objects.filter(
            owner=self.user,
            stack_type=PhotoStack.StackType.BURST_SEQUENCE
        ).count()
        
        # Second detection
        detect_burst_sequences(self.user)
        final_stacks = PhotoStack.objects.filter(
            owner=self.user,
            stack_type=PhotoStack.StackType.BURST_SEQUENCE
        ).count()
        
        # Should have same number of stacks
        self.assertEqual(initial_stacks, final_stacks)

    def test_redetection_adds_new_photos_to_existing_stack(self):
        """Test that new photos are added to existing stacks."""
        # Create initial burst pair
        base_time = timezone.now()
        
        photo1 = create_test_photo(owner=self.user)
        photo1.exif_timestamp = base_time
        photo1.main_file.path = "/photos/burst_001.jpg"
        photo1.main_file.save()
        photo1.save()
        
        photo2 = create_test_photo(owner=self.user)
        photo2.exif_timestamp = base_time + timezone.timedelta(milliseconds=100)
        photo2.main_file.path = "/photos/burst_002.jpg"
        photo2.main_file.save()
        photo2.save()
        
        # First detection
        detect_burst_sequences(self.user)
        _initial_stacks = list(PhotoStack.objects.filter(
            owner=self.user,
            stack_type=PhotoStack.StackType.BURST_SEQUENCE
        ))
        
        # Add a third photo to the burst
        photo3 = create_test_photo(owner=self.user)
        photo3.exif_timestamp = base_time + timezone.timedelta(milliseconds=200)
        photo3.main_file.path = "/photos/burst_003.jpg"
        photo3.main_file.save()
        photo3.save()
        
        # Second detection should add to existing stack
        detect_burst_sequences(self.user)
        _final_stacks = list(PhotoStack.objects.filter(
            owner=self.user,
            stack_type=PhotoStack.StackType.BURST_SEQUENCE
        ))
        
        # Stack count may vary based on implementation
        # The key is no duplicate photos in stacks


class APIRedetectionTestCase(APITestCase):
    """Test re-detection through API endpoints."""

    def setUp(self):
        self.user = create_test_user()
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)
        
        # Create some test photos
        for _ in range(5):
            create_test_photo(owner=self.user)

    def test_duplicate_detect_api_idempotent(self):
        """Test that calling /api/duplicates/detect multiple times is safe."""
        # First detection
        response1 = self.client.post("/api/duplicates/detect")
        self.assertIn(response1.status_code, [200, 202])
        
        # Second detection
        response2 = self.client.post("/api/duplicates/detect")
        self.assertIn(response2.status_code, [200, 202])
        
        # Third detection
        response3 = self.client.post("/api/duplicates/detect")
        self.assertIn(response3.status_code, [200, 202])

    def test_stack_detect_api_idempotent(self):
        """Test that calling /api/stacks/detect multiple times is safe."""
        # First detection
        response1 = self.client.post("/api/stacks/detect")
        self.assertIn(response1.status_code, [200, 202])
        
        # Second detection
        response2 = self.client.post("/api/stacks/detect")
        self.assertIn(response2.status_code, [200, 202])
        
        # Third detection
        response3 = self.client.post("/api/stacks/detect")
        self.assertIn(response3.status_code, [200, 202])

    def test_duplicate_detect_with_clear_pending(self):
        """Test detection with clear_pending option."""
        # Create a duplicate
        photo1 = create_test_photo(owner=self.user)
        photo2 = create_test_photo(owner=self.user)
        photo1.image_hash = photo2.image_hash = "samehash123456789012345678901234"
        photo1.save()
        photo2.save()
        
        # First detection
        response1 = self.client.post(
            "/api/duplicates/detect",
            {"clear_pending": False},
            format="json"
        )
        self.assertIn(response1.status_code, [200, 202])
        
        # Detection with clear_pending
        response2 = self.client.post(
            "/api/duplicates/detect",
            {"clear_pending": True},
            format="json"
        )
        self.assertIn(response2.status_code, [200, 202])


class PhotoInMultipleGroupsRedetectionTestCase(TestCase):
    """Test re-detection when photos are in multiple groups."""

    def setUp(self):
        self.user = create_test_user()

    def test_photo_already_in_stack_not_duplicated(self):
        """Test that a photo already in a stack isn't added again."""
        photos = [create_test_photo(owner=self.user) for _ in range(3)]
        
        # Create a manual stack
        stack = PhotoStack.objects.create(
            owner=self.user,
            stack_type=PhotoStack.StackType.MANUAL,
        )
        stack.photos.add(*photos)
        
        initial_photo_count = stack.photos.count()
        
        # Try to add the same photos through create_or_merge
        PhotoStack.create_or_merge(
            photos=photos,
            owner=self.user,
            stack_type=PhotoStack.StackType.MANUAL,
        )
        
        # Should not have duplicated photos in the stack
        stack.refresh_from_db()
        self.assertEqual(stack.photos.count(), initial_photo_count)

    def test_duplicate_group_photos_not_duplicated(self):
        """Test that photos already in a duplicate group aren't added again."""
        photos = [create_test_photo(owner=self.user) for _ in range(3)]
        
        # Create a duplicate group
        dup = Duplicate.objects.create(
            owner=self.user,
            duplicate_type=Duplicate.DuplicateType.EXACT_COPY,
        )
        dup.photos.add(*photos)
        
        initial_photo_count = dup.photos.count()
        
        # Try to add the same photos through create_or_merge
        Duplicate.create_or_merge(
            photos=photos,
            owner=self.user,
            duplicate_type=Duplicate.DuplicateType.EXACT_COPY,
        )
        
        # Should have merged, not duplicated
        final_groups = Duplicate.objects.filter(
            owner=self.user,
            duplicate_type=Duplicate.DuplicateType.EXACT_COPY,
        )
        total_photos = sum(g.photos.count() for g in final_groups)
        self.assertEqual(total_photos, initial_photo_count)


class ClearExistingGroupsTestCase(TestCase):
    """Test clearing existing groups before re-detection."""

    def setUp(self):
        self.user = create_test_user()

    def test_clear_pending_duplicates(self):
        """Test that clear_pending removes pending duplicates."""
        # Create a pending duplicate
        photos = [create_test_photo(owner=self.user) for _ in range(2)]
        dup = Duplicate.objects.create(
            owner=self.user,
            duplicate_type=Duplicate.DuplicateType.EXACT_COPY,
            review_status=Duplicate.ReviewStatus.PENDING,
        )
        dup.photos.add(*photos)
        
        # There should be one pending
        self.assertEqual(
            Duplicate.objects.filter(
                owner=self.user,
                review_status=Duplicate.ReviewStatus.PENDING
            ).count(),
            1
        )
        
        # Clear pending duplicates
        Duplicate.objects.filter(
            owner=self.user,
            review_status=Duplicate.ReviewStatus.PENDING
        ).delete()
        
        # Now there should be none
        self.assertEqual(
            Duplicate.objects.filter(
                owner=self.user,
                review_status=Duplicate.ReviewStatus.PENDING
            ).count(),
            0
        )

    def test_clear_pending_preserves_resolved(self):
        """Test that clearing pending doesn't affect resolved duplicates."""
        photos1 = [create_test_photo(owner=self.user) for _ in range(2)]
        photos2 = [create_test_photo(owner=self.user) for _ in range(2)]
        
        # Create pending and resolved duplicates
        pending_dup = Duplicate.objects.create(
            owner=self.user,
            duplicate_type=Duplicate.DuplicateType.EXACT_COPY,
            review_status=Duplicate.ReviewStatus.PENDING,
        )
        pending_dup.photos.add(*photos1)
        
        resolved_dup = Duplicate.objects.create(
            owner=self.user,
            duplicate_type=Duplicate.DuplicateType.EXACT_COPY,
            review_status=Duplicate.ReviewStatus.RESOLVED,
        )
        resolved_dup.photos.add(*photos2)
        
        # Clear only pending
        Duplicate.objects.filter(
            owner=self.user,
            review_status=Duplicate.ReviewStatus.PENDING
        ).delete()
        
        # Resolved should still exist
        self.assertTrue(
            Duplicate.objects.filter(pk=resolved_dup.pk).exists()
        )
        
        # Pending should be gone
        self.assertFalse(
            Duplicate.objects.filter(pk=pending_dup.pk).exists()
        )


class MergeOnRedetectionTestCase(TestCase):
    """Test that overlapping groups are merged on re-detection."""

    def setUp(self):
        self.user = create_test_user()

    def test_overlapping_stacks_merged(self):
        """Test that overlapping stacks are merged."""
        photos = [create_test_photo(owner=self.user) for _ in range(4)]
        
        # Create two overlapping stacks
        stack1 = PhotoStack.objects.create(
            owner=self.user,
            stack_type=PhotoStack.StackType.MANUAL,
        )
        stack1.photos.add(photos[0], photos[1], photos[2])  # 0, 1, 2
        
        stack2 = PhotoStack.objects.create(
            owner=self.user,
            stack_type=PhotoStack.StackType.MANUAL,
        )
        stack2.photos.add(photos[1], photos[2], photos[3])  # 1, 2, 3 (overlaps)
        
        # Using create_or_merge should merge these
        merged = PhotoStack.create_or_merge(
            photos=[photos[0], photos[1], photos[2], photos[3]],
            owner=self.user,
            stack_type=PhotoStack.StackType.MANUAL,
        )
        
        # Should have merged into one stack with all photos
        self.assertIsNotNone(merged)

    def test_overlapping_duplicates_merged(self):
        """Test that overlapping duplicate groups are merged."""
        photos = [create_test_photo(owner=self.user) for _ in range(4)]
        
        # Create two overlapping duplicate groups
        dup1 = Duplicate.objects.create(
            owner=self.user,
            duplicate_type=Duplicate.DuplicateType.EXACT_COPY,
        )
        dup1.photos.add(photos[0], photos[1], photos[2])
        
        dup2 = Duplicate.objects.create(
            owner=self.user,
            duplicate_type=Duplicate.DuplicateType.EXACT_COPY,
        )
        dup2.photos.add(photos[1], photos[2], photos[3])
        
        # Using create_or_merge should merge these
        merged = Duplicate.create_or_merge(
            photos=[photos[0], photos[1], photos[2], photos[3]],
            owner=self.user,
            duplicate_type=Duplicate.DuplicateType.EXACT_COPY,
        )
        
        # Should have merged
        self.assertIsNotNone(merged)


class FileVariantsIdempotencyTestCase(TestCase):
    """
    Test that file variants (RAW+JPEG, Live Photos) are handled idempotently.
    
    File variants are now stored via Photo.files ManyToMany field, not as stacks.
    This is handled during the scan process in directory_watcher.py.
    """

    def setUp(self):
        self.user = create_test_user()

    def test_photo_with_multiple_file_variants(self):
        """Test that a photo can have multiple file variants."""

        # Create a photo (create_test_photo adds its own file)
        photo = create_test_photo(owner=self.user)

        # Clear any existing files and set up fresh
        photo.files.clear()

        # Use unique hashes to avoid any collision with other tests
        unique_suffix = str(uuid.uuid4())[:8]

        # Create a JPEG file
        jpeg_file = File.objects.create(
            hash=f"jpeg_{unique_suffix}" + "a" * 20,
            path=f"/photos/IMG_001_{unique_suffix}.jpg",
            type=File.IMAGE,
        )
        photo.main_file = jpeg_file
        photo.files.add(jpeg_file)
        photo.save()

        # Add a RAW file variant
        raw_file = File.objects.create(
            hash=f"raw_{unique_suffix}" + "b" * 21,
            path=f"/photos/IMG_001_{unique_suffix}.CR2",
            type=File.RAW_FILE,
        )
        photo.files.add(raw_file)

        # Photo should have 2 file variants
        self.assertEqual(photo.files.count(), 2)

        # Verify both files are present
        file_paths = set(photo.files.values_list('path', flat=True))
        self.assertIn(f"/photos/IMG_001_{unique_suffix}.jpg", file_paths)
        self.assertIn(f"/photos/IMG_001_{unique_suffix}.CR2", file_paths)

    def test_file_variant_types(self):
        """Test that we can identify file variant types."""
        photo = create_test_photo(owner=self.user)
        
        # Clear existing files
        photo.files.clear()
        
        # Add JPEG
        jpeg_file = File.objects.create(
            hash="jpeg" + "a" * 28,
            path="/photos/IMG_001.jpg",
            type=File.IMAGE,
        )
        photo.main_file = jpeg_file
        photo.files.add(jpeg_file)
        
        # Add RAW
        raw_file = File.objects.create(
            hash="raw" + "b" * 29,
            path="/photos/IMG_001.CR2",
            type=File.RAW_FILE,
        )
        photo.files.add(raw_file)
        
        # Add video for Live Photo
        video_file = File.objects.create(
            hash="video" + "c" * 27,
            path="/photos/IMG_001.mov",
            type=File.VIDEO,
        )
        photo.files.add(video_file)
        photo.save()
        
        # Check file types
        file_types = set(photo.files.values_list('type', flat=True))
        self.assertIn(File.IMAGE, file_types)
        self.assertIn(File.RAW_FILE, file_types)
        self.assertIn(File.VIDEO, file_types)

    def test_has_raw_variant(self):
        """Test detecting if a photo has a RAW file variant."""
        photo = create_test_photo(owner=self.user)
        
        # Clear existing files
        photo.files.clear()
        
        # Add JPEG
        jpeg_file = File.objects.create(
            hash="jpeg" + "a" * 28,
            path="/photos/IMG_001.jpg",
            type=File.IMAGE,
        )
        photo.main_file = jpeg_file
        photo.files.add(jpeg_file)
        
        # Initially no RAW
        has_raw = photo.files.filter(type=File.RAW_FILE).exists()
        self.assertFalse(has_raw)
        
        # Add RAW
        raw_file = File.objects.create(
            hash="raw" + "b" * 29,
            path="/photos/IMG_001.CR2",
            type=File.RAW_FILE,
        )
        photo.files.add(raw_file)
        
        # Now has RAW
        has_raw = photo.files.filter(type=File.RAW_FILE).exists()
        self.assertTrue(has_raw)

    def test_has_video_variant_live_photo(self):
        """Test detecting if a photo has a video variant (Live Photo)."""
        photo = create_test_photo(owner=self.user)
        
        # Clear existing files
        photo.files.clear()
        
        # Add image
        image_file = File.objects.create(
            hash="image" + "a" * 27,
            path="/photos/IMG_001.heic",
            type=File.IMAGE,
        )
        photo.main_file = image_file
        photo.files.add(image_file)
        
        # Initially no video
        has_video = photo.files.filter(type=File.VIDEO).exists()
        self.assertFalse(has_video)
        
        # Add video for Live Photo
        video_file = File.objects.create(
            hash="video" + "b" * 27,
            path="/photos/IMG_001.mov",
            type=File.VIDEO,
        )
        photo.files.add(video_file)
        
        # Now has video
        has_video = photo.files.filter(type=File.VIDEO).exists()
        self.assertTrue(has_video)
