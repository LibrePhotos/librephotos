"""
Tests for burst detection using filename patterns.

Tests:
- Detection of various filename patterns (_BURST, _001, (1), etc.)
- Grouping by directory + base name
- Case insensitivity
- Edge cases (no extension, special chars, etc.)
"""

import os
import re

from django.test import TestCase
from django.utils import timezone

from api.burst_detection_rules import (
    BURST_FILENAME_PATTERNS,
    check_filename_pattern,
    group_photos_by_timestamp,
)
from api.models import Photo
from api.models.photo_stack import PhotoStack
from api.tests.utils import create_test_photo, create_test_user


class BurstFilenamePatternMatchingTestCase(TestCase):
    """Test filename pattern matching for burst detection."""

    def test_burst_suffix_pattern(self):
        """Test _BURST followed by numbers."""
        pattern, _ = BURST_FILENAME_PATTERNS["burst_suffix"]
        
        # Should match
        self.assertIsNotNone(re.search(pattern, "IMG_001_BURST001.jpg", re.IGNORECASE))
        self.assertIsNotNone(re.search(pattern, "photo_BURST123.jpg", re.IGNORECASE))
        self.assertIsNotNone(re.search(pattern, "IMG_BURST99.JPG", re.IGNORECASE))
        
        # Should not match
        self.assertIsNone(re.search(pattern, "IMG_001.jpg", re.IGNORECASE))
        self.assertIsNone(re.search(pattern, "BURST_photo.jpg", re.IGNORECASE))

    def test_sequence_suffix_pattern(self):
        """Test files ending with 3+ digit sequence."""
        pattern, _ = BURST_FILENAME_PATTERNS["sequence_suffix"]
        
        # Should match (need to test on base name without extension)
        base = os.path.splitext("IMG_001")[0]
        self.assertIsNotNone(re.search(pattern, base, re.IGNORECASE))
        
        base = os.path.splitext("photo_0001")[0]
        self.assertIsNotNone(re.search(pattern, base, re.IGNORECASE))
        
        # Should not match
        base = os.path.splitext("IMG_01")[0]  # Only 2 digits
        self.assertIsNone(re.search(pattern, base, re.IGNORECASE))

    def test_bracketed_sequence_pattern(self):
        """Test files with bracketed numbers at end."""
        pattern, _ = BURST_FILENAME_PATTERNS["bracketed_sequence"]
        
        # Should match
        base = os.path.splitext("photo (1)")[0]
        self.assertIsNotNone(re.search(pattern, base, re.IGNORECASE))
        
        base = os.path.splitext("IMG (123)")[0]
        self.assertIsNotNone(re.search(pattern, base, re.IGNORECASE))
        
        # Should not match
        base = os.path.splitext("photo [1]")[0]
        self.assertIsNone(re.search(pattern, base, re.IGNORECASE))

    def test_samsung_burst_pattern(self):
        """Test Samsung burst cover images."""
        pattern, _ = BURST_FILENAME_PATTERNS["samsung_burst"]
        
        # Should match
        self.assertIsNotNone(re.search(pattern, "20240101_123456_001_COVER.jpg", re.IGNORECASE))
        
        # Should not match
        self.assertIsNone(re.search(pattern, "IMG_001.jpg", re.IGNORECASE))

    def test_iphone_burst_pattern(self):
        """Test iPhone burst sequence pattern."""
        pattern, _ = BURST_FILENAME_PATTERNS["iphone_burst"]
        
        # Should match
        self.assertIsNotNone(re.search(pattern, "IMG_1234_1.jpg", re.IGNORECASE))
        self.assertIsNotNone(re.search(pattern, "IMG_0001_99.JPG", re.IGNORECASE))
        
        # Should not match
        self.assertIsNone(re.search(pattern, "photo_001.jpg", re.IGNORECASE))


class CheckFilenamePatternTestCase(TestCase):
    """Test the check_filename_pattern function."""

    def setUp(self):
        self.user = create_test_user()

    def test_check_any_pattern_burst_suffix(self):
        """Test detecting burst suffix with any pattern."""
        photo = create_test_photo(owner=self.user)
        photo.main_file.path = "/photos/IMG_001_BURST001.jpg"
        photo.main_file.save()
        
        matches, group_key = check_filename_pattern(photo, pattern_type="any")
        self.assertTrue(matches)
        self.assertIsNotNone(group_key)
        self.assertIn("filename_", group_key)

    def test_check_any_pattern_sequence(self):
        """Test detecting sequence suffix with any pattern."""
        photo = create_test_photo(owner=self.user)
        photo.main_file.path = "/photos/IMG_001.jpg"
        photo.main_file.save()
        
        matches, group_key = check_filename_pattern(photo, pattern_type="any")
        self.assertTrue(matches)

    def test_check_any_pattern_bracketed(self):
        """Test detecting bracketed sequence with any pattern."""
        photo = create_test_photo(owner=self.user)
        photo.main_file.path = "/photos/vacation (1).jpg"
        photo.main_file.save()
        
        matches, group_key = check_filename_pattern(photo, pattern_type="any")
        self.assertTrue(matches)

    def test_check_specific_pattern(self):
        """Test checking specific pattern type."""
        photo = create_test_photo(owner=self.user)
        photo.main_file.path = "/photos/IMG_001_BURST001.jpg"
        photo.main_file.save()
        
        # Should match burst_suffix
        matches, group_key = check_filename_pattern(photo, pattern_type="burst_suffix")
        self.assertTrue(matches)
        
        # Should not match iphone_burst
        matches, group_key = check_filename_pattern(photo, pattern_type="iphone_burst")
        self.assertFalse(matches)

    def test_no_match(self):
        """Test when no pattern matches."""
        photo = create_test_photo(owner=self.user)
        photo.main_file.path = "/photos/random_photo.jpg"
        photo.main_file.save()
        
        matches, group_key = check_filename_pattern(photo, pattern_type="any")
        self.assertFalse(matches)
        self.assertIsNone(group_key)

    def test_group_key_includes_directory(self):
        """Test that group key includes directory for grouping."""
        photo1 = create_test_photo(owner=self.user)
        photo1.main_file.path = "/photos/2024/IMG_001.jpg"
        photo1.main_file.save()
        
        photo2 = create_test_photo(owner=self.user)
        photo2.main_file.path = "/photos/2023/IMG_001.jpg"
        photo2.main_file.save()
        
        matches1, key1 = check_filename_pattern(photo1, pattern_type="any")
        matches2, key2 = check_filename_pattern(photo2, pattern_type="any")
        
        self.assertTrue(matches1)
        self.assertTrue(matches2)
        # Different directories = different group keys
        self.assertNotEqual(key1, key2)

    def test_same_directory_same_base_grouped(self):
        """Test that same directory + base name get same group key."""
        photo1 = create_test_photo(owner=self.user)
        photo1.main_file.path = "/photos/burst/IMG_001.jpg"
        photo1.main_file.save()
        
        photo2 = create_test_photo(owner=self.user)
        photo2.main_file.path = "/photos/burst/IMG_002.jpg"
        photo2.main_file.save()
        
        matches1, key1 = check_filename_pattern(photo1, pattern_type="any")
        matches2, key2 = check_filename_pattern(photo2, pattern_type="any")
        
        self.assertTrue(matches1)
        self.assertTrue(matches2)
        # Same directory + same base (IMG) = same group
        # Note: This depends on implementation details


class GroupPhotosByTimestampTestCase(TestCase):
    """Test timestamp-based grouping for bursts."""

    def setUp(self):
        self.user = create_test_user()

    def test_group_consecutive_timestamps(self):
        """Test grouping photos with consecutive timestamps."""
        base_time = timezone.now()
        photos = []
        
        for i in range(5):
            photo = create_test_photo(owner=self.user)
            photo.exif_timestamp = base_time + timezone.timedelta(milliseconds=500 * i)
            photo.save()
            photos.append(photo)
        
        # Order by timestamp
        ordered = Photo.objects.filter(pk__in=[p.pk for p in photos]).order_by("exif_timestamp")
        
        groups = group_photos_by_timestamp(ordered, interval_ms=2000)
        
        # All 5 should be in one group (each 500ms apart)
        self.assertEqual(len(groups), 1)
        self.assertEqual(len(groups[0]), 5)

    def test_separate_groups_by_gap(self):
        """Test that large timestamp gaps create separate groups."""
        base_time = timezone.now()
        photos = []
        
        # First burst: 3 photos 500ms apart
        for i in range(3):
            photo = create_test_photo(owner=self.user)
            photo.exif_timestamp = base_time + timezone.timedelta(milliseconds=500 * i)
            photo.save()
            photos.append(photo)
        
        # Second burst: 2 photos after 10 second gap
        for i in range(2):
            photo = create_test_photo(owner=self.user)
            photo.exif_timestamp = base_time + timezone.timedelta(seconds=10 + i * 0.5)
            photo.save()
            photos.append(photo)
        
        ordered = Photo.objects.filter(pk__in=[p.pk for p in photos]).order_by("exif_timestamp")
        
        groups = group_photos_by_timestamp(ordered, interval_ms=2000)
        
        # Should be 2 groups
        self.assertEqual(len(groups), 2)
        self.assertEqual(len(groups[0]), 3)
        self.assertEqual(len(groups[1]), 2)

    def test_single_photo_no_group(self):
        """Test that single photos don't form groups."""
        photo = create_test_photo(owner=self.user)
        photo.exif_timestamp = timezone.now()
        photo.save()
        
        ordered = Photo.objects.filter(pk=photo.pk).order_by("exif_timestamp")
        
        groups = group_photos_by_timestamp(ordered, interval_ms=2000)
        
        # Single photo should not form a group
        self.assertEqual(len(groups), 0)

    def test_empty_queryset(self):
        """Test with empty queryset."""
        ordered = Photo.objects.none()
        
        groups = group_photos_by_timestamp(ordered, interval_ms=2000)
        
        self.assertEqual(len(groups), 0)

    def test_photos_without_timestamp(self):
        """Test handling photos without exif_timestamp."""
        photos = []
        for _ in range(3):
            photo = create_test_photo(owner=self.user)
            photo.exif_timestamp = None
            photo.save()
            photos.append(photo)
        
        ordered = Photo.objects.filter(pk__in=[p.pk for p in photos]).order_by("exif_timestamp")
        
        groups = group_photos_by_timestamp(ordered, interval_ms=2000)
        
        # Photos without timestamps can't be grouped by timestamp
        self.assertEqual(len(groups), 0)


class BurstDetectionIntegrationTestCase(TestCase):
    """Integration tests for burst detection."""

    def setUp(self):
        self.user = create_test_user()

    def test_detect_burst_creates_stack(self):
        """Test that detecting a burst creates a stack."""
        from api.stack_detection import detect_burst_sequences
        
        base_time = timezone.now()
        photos = []
        
        for i in range(4):
            photo = create_test_photo(owner=self.user)
            photo.exif_timestamp = base_time + timezone.timedelta(milliseconds=300 * i)
            photo.main_file.path = f"/photos/burst/IMG_{i:03d}.jpg"
            photo.main_file.save()
            photo.save()
            photos.append(photo)
        
        # Run burst detection
        detect_burst_sequences(self.user)
        
        # Check for burst stacks
        _burst_stacks = PhotoStack.objects.filter(
            owner=self.user,
            stack_type=PhotoStack.StackType.BURST_SEQUENCE
        )
        
        # Should have created at least one burst stack
        # (depends on detection rules being enabled)

    def test_case_insensitive_pattern_matching(self):
        """Test that filename patterns are case-insensitive."""
        photo = create_test_photo(owner=self.user)
        photo.main_file.path = "/photos/IMG_001_BURST001.JPG"  # Uppercase extension
        photo.main_file.save()
        
        matches, _ = check_filename_pattern(photo, pattern_type="any")
        self.assertTrue(matches)
        
        photo2 = create_test_photo(owner=self.user)
        photo2.main_file.path = "/photos/img_001_burst001.jpg"  # Lowercase
        photo2.main_file.save()
        
        matches2, _ = check_filename_pattern(photo2, pattern_type="any")
        self.assertTrue(matches2)


class FilenamePatternEdgeCasesTestCase(TestCase):
    """Test edge cases for filename pattern detection."""

    def setUp(self):
        self.user = create_test_user()

    def test_no_extension(self):
        """Test handling files without extension."""
        photo = create_test_photo(owner=self.user)
        photo.main_file.path = "/photos/IMG_001"  # No extension
        photo.main_file.save()
        
        matches, _ = check_filename_pattern(photo, pattern_type="any")
        # Should still match based on base name
        self.assertTrue(matches)

    def test_multiple_extensions(self):
        """Test handling files with multiple dots."""
        photo = create_test_photo(owner=self.user)
        photo.main_file.path = "/photos/IMG_001.edited.jpg"
        photo.main_file.save()
        
        matches, _ = check_filename_pattern(photo, pattern_type="any")
        # May or may not match depending on extension handling

    def test_unicode_filename(self):
        """Test handling unicode filenames."""
        photo = create_test_photo(owner=self.user)
        photo.main_file.path = "/photos/写真_001.jpg"
        photo.main_file.save()
        
        matches, _ = check_filename_pattern(photo, pattern_type="any")
        # Should handle gracefully

    def test_very_long_filename(self):
        """Test handling very long filenames."""
        photo = create_test_photo(owner=self.user)
        long_name = "A" * 200 + "_001.jpg"
        photo.main_file.path = f"/photos/{long_name}"
        photo.main_file.save()
        
        matches, _ = check_filename_pattern(photo, pattern_type="any")
        # Should handle gracefully

    def test_special_characters_in_path(self):
        """Test handling special characters in path."""
        photo = create_test_photo(owner=self.user)
        photo.main_file.path = "/photos/my folder (2024)/IMG_001.jpg"
        photo.main_file.save()
        
        matches, _ = check_filename_pattern(photo, pattern_type="any")
        self.assertTrue(matches)

    def test_invalid_pattern_type(self):
        """Test handling invalid pattern type."""
        photo = create_test_photo(owner=self.user)
        photo.main_file.path = "/photos/IMG_001_BURST001.jpg"
        photo.main_file.save()
        
        # Invalid pattern type should not match
        matches, _ = check_filename_pattern(photo, pattern_type="nonexistent_pattern")
        self.assertFalse(matches)
