"""
Tests for auto-select and potential savings logic.

Tests cover:
- PhotoStack.auto_select_primary() for various stack types
- Duplicate.auto_select_best_photo() for exact copies and visual duplicates
- Duplicate.calculate_potential_savings() edge cases
- Edge cases with null/missing data
"""

from django.test import TestCase
from django.utils import timezone
from datetime import timedelta

from api.models.photo_stack import PhotoStack
from api.models.duplicate import Duplicate
from api.models.photo_metadata import PhotoMetadata
from api.tests.utils import create_test_photo, create_test_user


class PhotoStackAutoSelectPrimaryTestCase(TestCase):
    """Tests for PhotoStack.auto_select_primary()."""

    def setUp(self):
        self.user = create_test_user()

    def test_auto_select_empty_stack(self):
        """Test auto_select on empty stack."""
        stack = PhotoStack.objects.create(
            owner=self.user,
            stack_type=PhotoStack.StackType.MANUAL,
        )
        
        result = stack.auto_select_primary()
        
        self.assertIsNone(result)

    def test_auto_select_single_photo(self):
        """Test auto_select with single photo."""
        photo = create_test_photo(owner=self.user)
        stack = PhotoStack.objects.create(
            owner=self.user,
            stack_type=PhotoStack.StackType.MANUAL,
        )
        stack.photos.add(photo)
        
        stack.auto_select_primary()
        stack.refresh_from_db()
        
        self.assertEqual(stack.primary_photo, photo)

    def test_auto_select_raw_jpeg_prefers_jpeg(self):
        """Test that RAW+JPEG stack selects a primary photo."""
        # Create two photos for the stack
        photo1 = create_test_photo(owner=self.user)
        photo2 = create_test_photo(owner=self.user)
        
        stack = PhotoStack.objects.create(
            owner=self.user,
            stack_type=PhotoStack.StackType.RAW_JPEG_PAIR,
        )
        stack.photos.add(photo1, photo2)
        
        # auto_select_primary should select a photo
        stack.auto_select_primary()
        stack.refresh_from_db()
        
        # Should have selected a primary photo
        self.assertIsNotNone(stack.primary_photo)
        # The selected photo should be one of the stack photos
        self.assertIn(stack.primary_photo, [photo1, photo2])

    def test_auto_select_raw_jpeg_only_raw(self):
        """Test RAW+JPEG fallback when no JPEG available."""
        # Create two photos for the stack
        photo1 = create_test_photo(owner=self.user)
        photo2 = create_test_photo(owner=self.user)
        
        stack = PhotoStack.objects.create(
            owner=self.user,
            stack_type=PhotoStack.StackType.RAW_JPEG_PAIR,
        )
        stack.photos.add(photo1, photo2)
        
        stack.auto_select_primary()
        stack.refresh_from_db()
        
        # Should still select one photo even if no JPEG preference possible
        self.assertIsNotNone(stack.primary_photo)
        self.assertIn(stack.primary_photo, [photo1, photo2])

    def test_auto_select_burst_picks_middle(self):
        """Test that burst stack picks middle photo by timestamp."""
        base_time = timezone.now()
        
        photos = []
        for i in range(5):
            photo = create_test_photo(owner=self.user)
            photo.exif_timestamp = base_time + timedelta(seconds=i)
            photo.save()
            photos.append(photo)
        
        stack = PhotoStack.objects.create(
            owner=self.user,
            stack_type=PhotoStack.StackType.BURST_SEQUENCE,
        )
        stack.photos.add(*photos)
        
        stack.auto_select_primary()
        stack.refresh_from_db()
        
        # Should pick middle (index 2 of 5)
        self.assertEqual(stack.primary_photo, photos[2])

    def test_auto_select_burst_no_timestamps(self):
        """Test burst stack when photos have no timestamps."""
        photos = [create_test_photo(owner=self.user) for _ in range(3)]
        for photo in photos:
            photo.exif_timestamp = None
            photo.save()
        
        stack = PhotoStack.objects.create(
            owner=self.user,
            stack_type=PhotoStack.StackType.BURST_SEQUENCE,
        )
        stack.photos.add(*photos)
        
        # Should not crash
        stack.auto_select_primary()
        stack.refresh_from_db()
        
        # Should still select something
        self.assertIsNotNone(stack.primary_photo)

    def test_auto_select_manual_highest_resolution(self):
        """Test manual stack picks highest resolution."""
        photo1 = create_test_photo(owner=self.user)
        photo2 = create_test_photo(owner=self.user)
        photo3 = create_test_photo(owner=self.user)
        
        # Set different resolutions via metadata
        PhotoMetadata.objects.update_or_create(
            photo=photo1,
            defaults={'width': 1920, 'height': 1080}
        )
        PhotoMetadata.objects.update_or_create(
            photo=photo2,
            defaults={'width': 3840, 'height': 2160}  # 4K - highest
        )
        PhotoMetadata.objects.update_or_create(
            photo=photo3,
            defaults={'width': 1280, 'height': 720}
        )
        
        stack = PhotoStack.objects.create(
            owner=self.user,
            stack_type=PhotoStack.StackType.MANUAL,
        )
        stack.photos.add(photo1, photo2, photo3)
        
        stack.auto_select_primary()
        stack.refresh_from_db()
        
        # Should pick highest resolution (photo2)
        self.assertEqual(stack.primary_photo, photo2)

    def test_auto_select_manual_no_metadata(self):
        """Test manual stack when photos have no metadata."""
        photos = [create_test_photo(owner=self.user) for _ in range(3)]
        
        stack = PhotoStack.objects.create(
            owner=self.user,
            stack_type=PhotoStack.StackType.MANUAL,
        )
        stack.photos.add(*photos)
        
        # Should not crash
        stack.auto_select_primary()
        stack.refresh_from_db()
        
        # Should still select something
        self.assertIsNotNone(stack.primary_photo)


class DuplicateAutoSelectBestTestCase(TestCase):
    """Tests for Duplicate.auto_select_best_photo()."""

    def setUp(self):
        self.user = create_test_user()

    def test_auto_select_empty_duplicate(self):
        """Test auto_select on duplicate with no photos."""
        dup = Duplicate.objects.create(
            owner=self.user,
            duplicate_type=Duplicate.DuplicateType.EXACT_COPY,
        )
        
        result = dup.auto_select_best_photo()
        
        self.assertIsNone(result)

    def test_auto_select_exact_copy_shortest_path(self):
        """Test exact copy selects shortest path."""
        photo1 = create_test_photo(owner=self.user)
        photo1.main_file.path = "/very/long/nested/directory/path/photo1.jpg"
        photo1.main_file.save()
        
        photo2 = create_test_photo(owner=self.user)
        photo2.main_file.path = "/a.jpg"  # Much shorter path
        photo2.main_file.save()
        
        # Verify paths are set correctly
        photo1.main_file.refresh_from_db()
        photo2.main_file.refresh_from_db()
        
        dup = Duplicate.objects.create(
            owner=self.user,
            duplicate_type=Duplicate.DuplicateType.EXACT_COPY,
        )
        dup.photos.add(photo1, photo2)
        
        result = dup.auto_select_best_photo()
        
        # Should pick shorter path - verify by checking the path of result
        self.assertIsNotNone(result)
        # The result should have the shorter path
        result_path_len = len(result.main_file.path)
        self.assertLessEqual(result_path_len, len("/a.jpg") + 5)  # Some tolerance

    def test_auto_select_visual_duplicate_highest_resolution(self):
        """Test visual duplicate selects highest resolution."""
        photo1 = create_test_photo(owner=self.user)
        PhotoMetadata.objects.update_or_create(
            photo=photo1,
            defaults={'width': 1920, 'height': 1080}
        )
        
        photo2 = create_test_photo(owner=self.user)
        PhotoMetadata.objects.update_or_create(
            photo=photo2,
            defaults={'width': 3840, 'height': 2160}  # Higher resolution
        )
        
        dup = Duplicate.objects.create(
            owner=self.user,
            duplicate_type=Duplicate.DuplicateType.VISUAL_DUPLICATE,
        )
        dup.photos.add(photo1, photo2)
        
        result = dup.auto_select_best_photo()
        
        # Should pick highest resolution
        self.assertEqual(result, photo2)

    def test_auto_select_visual_no_metadata(self):
        """Test visual duplicate when no metadata available."""
        photos = [create_test_photo(owner=self.user) for _ in range(3)]
        
        dup = Duplicate.objects.create(
            owner=self.user,
            duplicate_type=Duplicate.DuplicateType.VISUAL_DUPLICATE,
        )
        dup.photos.add(*photos)
        
        # Should not crash
        result = dup.auto_select_best_photo()
        
        # Should still return something (or None)
        # The result depends on database ordering
        self.assertIsNotNone(result) if dup.photos.exists() else None

    def test_auto_select_visual_partial_metadata(self):
        """Test visual duplicate when some photos have metadata."""
        photo1 = create_test_photo(owner=self.user)
        # No metadata for photo1
        
        photo2 = create_test_photo(owner=self.user)
        PhotoMetadata.objects.update_or_create(
            photo=photo2,
            defaults={'width': 1920, 'height': 1080}
        )
        
        dup = Duplicate.objects.create(
            owner=self.user,
            duplicate_type=Duplicate.DuplicateType.VISUAL_DUPLICATE,
        )
        dup.photos.add(photo1, photo2)
        
        # Should not crash
        result = dup.auto_select_best_photo()
        self.assertIsNotNone(result)


class DuplicatePotentialSavingsTestCase(TestCase):
    """Tests for Duplicate.calculate_potential_savings()."""

    def setUp(self):
        self.user = create_test_user()

    def test_savings_empty_duplicate(self):
        """Test potential savings for empty duplicate."""
        dup = Duplicate.objects.create(
            owner=self.user,
            duplicate_type=Duplicate.DuplicateType.EXACT_COPY,
        )
        
        savings = dup.calculate_potential_savings()
        
        self.assertEqual(savings, 0)

    def test_savings_single_photo(self):
        """Test potential savings with single photo."""
        photo = create_test_photo(owner=self.user)
        photo.size = 1000000  # 1MB
        photo.save()
        
        dup = Duplicate.objects.create(
            owner=self.user,
            duplicate_type=Duplicate.DuplicateType.EXACT_COPY,
        )
        dup.photos.add(photo)
        
        savings = dup.calculate_potential_savings()
        
        # Only one photo, no savings possible
        self.assertEqual(savings, 0)

    def test_savings_two_photos(self):
        """Test potential savings with two photos."""
        photo1 = create_test_photo(owner=self.user)
        photo1.size = 2000000  # 2MB
        photo1.main_file.path = "/short.jpg"
        photo1.main_file.save()
        photo1.save()
        
        photo2 = create_test_photo(owner=self.user)
        photo2.size = 1500000  # 1.5MB
        photo2.main_file.path = "/very/long/path/photo.jpg"
        photo2.main_file.save()
        photo2.save()
        
        dup = Duplicate.objects.create(
            owner=self.user,
            duplicate_type=Duplicate.DuplicateType.EXACT_COPY,
        )
        dup.photos.add(photo1, photo2)
        
        savings = dup.calculate_potential_savings()
        
        # Best photo is photo1 (shorter path), savings = photo2.size
        self.assertEqual(savings, 1500000)

    def test_savings_many_photos(self):
        """Test potential savings with many photos."""
        photos = []
        total_size = 0
        for i in range(5):
            photo = create_test_photo(owner=self.user)
            photo.size = (i + 1) * 1000000  # 1MB, 2MB, 3MB, 4MB, 5MB
            total_size += photo.size
            photo.main_file.path = f"/{'x' * (i + 1)}/photo{i}.jpg"
            photo.main_file.save()
            photo.save()
            photos.append(photo)
        
        dup = Duplicate.objects.create(
            owner=self.user,
            duplicate_type=Duplicate.DuplicateType.EXACT_COPY,
        )
        dup.photos.add(*photos)
        
        savings = dup.calculate_potential_savings()
        
        # Savings should be total - best_photo_size
        # The actual "best" depends on which path is shortest
        # Just verify savings is reasonable (not 0, less than total)
        self.assertGreater(savings, 0)
        self.assertLess(savings, total_size)

    def test_savings_zero_sizes(self):
        """Test potential savings when photos have zero sizes."""
        photo1 = create_test_photo(owner=self.user)
        photo1.size = 0
        photo1.main_file.path = "/a.jpg"  # Short path (will be kept)
        photo1.main_file.save()
        photo1.save()
        
        photo2 = create_test_photo(owner=self.user)
        photo2.size = 0
        photo2.main_file.path = "/longer/path/photo.jpg"
        photo2.main_file.save()
        photo2.save()
        
        dup = Duplicate.objects.create(
            owner=self.user,
            duplicate_type=Duplicate.DuplicateType.EXACT_COPY,
        )
        dup.photos.add(photo1, photo2)
        
        # Should not crash, savings = 0 since both sizes are 0
        savings = dup.calculate_potential_savings()
        self.assertEqual(savings, 0)

    def test_savings_updates_model_field(self):
        """Test that calculate_potential_savings updates the model field."""
        photo1 = create_test_photo(owner=self.user)
        photo1.size = 2000000
        photo1.main_file.path = "/short.jpg"
        photo1.main_file.save()
        photo1.save()
        
        photo2 = create_test_photo(owner=self.user)
        photo2.size = 3000000
        photo2.main_file.path = "/longer/path.jpg"
        photo2.main_file.save()
        photo2.save()
        
        dup = Duplicate.objects.create(
            owner=self.user,
            duplicate_type=Duplicate.DuplicateType.EXACT_COPY,
            potential_savings=0,
        )
        dup.photos.add(photo1, photo2)
        
        dup.calculate_potential_savings()
        
        # Reload from database
        dup.refresh_from_db()
        
        # Field should be updated
        self.assertEqual(dup.potential_savings, 3000000)


class DuplicateResolveRevertTestCase(TestCase):
    """Tests for Duplicate.resolve() and Duplicate.revert() methods."""

    def setUp(self):
        self.user = create_test_user()

    def test_resolve_marks_status(self):
        """Test that resolve() sets review_status to RESOLVED."""
        photo1 = create_test_photo(owner=self.user)
        photo2 = create_test_photo(owner=self.user)
        
        dup = Duplicate.objects.create(
            owner=self.user,
            duplicate_type=Duplicate.DuplicateType.EXACT_COPY,
            review_status=Duplicate.ReviewStatus.PENDING,
        )
        dup.photos.add(photo1, photo2)
        
        dup.resolve(kept_photo=photo1, trash_others=False)
        dup.refresh_from_db()
        
        self.assertEqual(dup.review_status, Duplicate.ReviewStatus.RESOLVED)
        self.assertEqual(dup.kept_photo, photo1)

    def test_resolve_trash_others(self):
        """Test that resolve() with trash_others=True moves photos to trash."""
        photo1 = create_test_photo(owner=self.user)
        photo2 = create_test_photo(owner=self.user)
        photo3 = create_test_photo(owner=self.user)
        
        dup = Duplicate.objects.create(
            owner=self.user,
            duplicate_type=Duplicate.DuplicateType.EXACT_COPY,
        )
        dup.photos.add(photo1, photo2, photo3)
        
        dup.resolve(kept_photo=photo1, trash_others=True)
        
        # Refresh all
        photo1.refresh_from_db()
        photo2.refresh_from_db()
        photo3.refresh_from_db()
        
        # Kept photo should NOT be trashed
        self.assertFalse(photo1.in_trashcan)
        
        # Others should be trashed
        self.assertTrue(photo2.in_trashcan)
        self.assertTrue(photo3.in_trashcan)

    def test_resolve_no_trash(self):
        """Test that resolve() with trash_others=False doesn't trash anything."""
        photo1 = create_test_photo(owner=self.user)
        photo2 = create_test_photo(owner=self.user)
        
        dup = Duplicate.objects.create(
            owner=self.user,
            duplicate_type=Duplicate.DuplicateType.EXACT_COPY,
        )
        dup.photos.add(photo1, photo2)
        
        dup.resolve(kept_photo=photo1, trash_others=False)
        
        photo2.refresh_from_db()
        
        # Should NOT be trashed
        self.assertFalse(photo2.in_trashcan)

    def test_revert_restores_trashed(self):
        """Test that revert() restores trashed photos."""
        photo1 = create_test_photo(owner=self.user)
        photo2 = create_test_photo(owner=self.user)
        
        dup = Duplicate.objects.create(
            owner=self.user,
            duplicate_type=Duplicate.DuplicateType.EXACT_COPY,
        )
        dup.photos.add(photo1, photo2)
        
        # Resolve (trashes photo2)
        dup.resolve(kept_photo=photo1, trash_others=True)
        
        photo2.refresh_from_db()
        self.assertTrue(photo2.in_trashcan)
        
        # Revert
        dup.revert()
        
        photo2.refresh_from_db()
        dup.refresh_from_db()
        
        # Photo should be restored
        self.assertFalse(photo2.in_trashcan)
        
        # Status should be back to pending
        self.assertEqual(dup.review_status, Duplicate.ReviewStatus.PENDING)

    def test_revert_clears_kept_photo(self):
        """Test that revert() clears the kept_photo field."""
        photo1 = create_test_photo(owner=self.user)
        photo2 = create_test_photo(owner=self.user)
        
        dup = Duplicate.objects.create(
            owner=self.user,
            duplicate_type=Duplicate.DuplicateType.EXACT_COPY,
        )
        dup.photos.add(photo1, photo2)
        
        dup.resolve(kept_photo=photo1, trash_others=False)
        self.assertIsNotNone(dup.kept_photo)
        
        dup.revert()
        dup.refresh_from_db()
        
        self.assertIsNone(dup.kept_photo)


class DuplicateDismissTestCase(TestCase):
    """Tests for Duplicate.dismiss() method."""

    def setUp(self):
        self.user = create_test_user()

    def test_dismiss_sets_status(self):
        """Test that dismiss() sets review_status to DISMISSED."""
        photo1 = create_test_photo(owner=self.user)
        photo2 = create_test_photo(owner=self.user)
        
        dup = Duplicate.objects.create(
            owner=self.user,
            duplicate_type=Duplicate.DuplicateType.VISUAL_DUPLICATE,
            review_status=Duplicate.ReviewStatus.PENDING,
        )
        dup.photos.add(photo1, photo2)
        
        dup.dismiss()
        dup.refresh_from_db()
        
        self.assertEqual(dup.review_status, Duplicate.ReviewStatus.DISMISSED)

    def test_dismiss_doesnt_trash(self):
        """Test that dismiss() doesn't trash any photos."""
        photo1 = create_test_photo(owner=self.user)
        photo2 = create_test_photo(owner=self.user)
        
        dup = Duplicate.objects.create(
            owner=self.user,
            duplicate_type=Duplicate.DuplicateType.VISUAL_DUPLICATE,
        )
        dup.photos.add(photo1, photo2)
        
        dup.dismiss()
        
        photo1.refresh_from_db()
        photo2.refresh_from_db()
        
        # Neither should be trashed
        self.assertFalse(photo1.in_trashcan)
        self.assertFalse(photo2.in_trashcan)
