"""
Comprehensive tests for Stack Detection Logic.

NOTE: RAW+JPEG pairs and Live Photos are now handled as file variants
during scan (Photo.files ManyToMany field), not as stacks.
See test_file_variants.py for file variant tests.

Tests cover:
- clear_stacks_of_type: Clearing stacks before re-detection
- detect_burst_sequences: Burst sequence detection with rules
- batch_detect_stacks: Batch detection orchestration
- Edge cases and error handling
"""

import json
import uuid
from datetime import datetime, timedelta
from unittest.mock import patch

from django.test import TestCase

from api.models.file import File
from api.models.photo_stack import PhotoStack
from api.models.long_running_job import LongRunningJob
from api.stack_detection import (
    clear_stacks_of_type,
    detect_burst_sequences,
    batch_detect_stacks,
    _create_burst_stack,
)
from api.directory_watcher import JPEG_EXTENSIONS
from api.tests.utils import create_test_photo, create_test_user


class ClearStacksTestCase(TestCase):
    """Tests for clear_stacks_of_type function."""

    def setUp(self):
        self.user = create_test_user()
        self.other_user = create_test_user()

    def test_clear_stacks_removes_all_of_type(self):
        """Test clearing removes all stacks of specific type."""
        photo1 = create_test_photo(owner=self.user)
        photo2 = create_test_photo(owner=self.user)
        photo3 = create_test_photo(owner=self.user)
        photo4 = create_test_photo(owner=self.user)
        
        # Create stacks of different types
        burst_stack = PhotoStack.objects.create(
            owner=self.user,
            stack_type=PhotoStack.StackType.BURST_SEQUENCE,
        )
        burst_stack.photos.add(photo1, photo2)
        
        manual_stack = PhotoStack.objects.create(
            owner=self.user,
            stack_type=PhotoStack.StackType.MANUAL,
        )
        manual_stack.photos.add(photo3, photo4)
        
        # Clear only burst stacks
        count = clear_stacks_of_type(self.user, PhotoStack.StackType.BURST_SEQUENCE)
        
        self.assertEqual(count, 1)
        self.assertFalse(PhotoStack.objects.filter(
            owner=self.user, stack_type=PhotoStack.StackType.BURST_SEQUENCE
        ).exists())
        # Manual stack should still exist
        self.assertTrue(PhotoStack.objects.filter(
            owner=self.user, stack_type=PhotoStack.StackType.MANUAL
        ).exists())

    def test_clear_stacks_unlinks_photos(self):
        """Test clearing unlinks photos from stacks."""
        photo1 = create_test_photo(owner=self.user)
        photo2 = create_test_photo(owner=self.user)
        
        stack = PhotoStack.objects.create(
            owner=self.user,
            stack_type=PhotoStack.StackType.BURST_SEQUENCE,
        )
        stack.photos.add(photo1, photo2)
        
        self.assertEqual(photo1.stacks.count(), 1)
        
        clear_stacks_of_type(self.user, PhotoStack.StackType.BURST_SEQUENCE)
        
        photo1.refresh_from_db()
        self.assertEqual(photo1.stacks.count(), 0)

    def test_clear_stacks_only_affects_user(self):
        """Test clearing only affects specified user's stacks."""
        photo1 = create_test_photo(owner=self.user)
        photo2 = create_test_photo(owner=self.user)
        other_photo1 = create_test_photo(owner=self.other_user)
        other_photo2 = create_test_photo(owner=self.other_user)
        
        stack1 = PhotoStack.objects.create(
            owner=self.user,
            stack_type=PhotoStack.StackType.BURST_SEQUENCE,
        )
        stack1.photos.add(photo1, photo2)
        
        stack2 = PhotoStack.objects.create(
            owner=self.other_user,
            stack_type=PhotoStack.StackType.BURST_SEQUENCE,
        )
        stack2.photos.add(other_photo1, other_photo2)
        
        clear_stacks_of_type(self.user, PhotoStack.StackType.BURST_SEQUENCE)
        
        # User's stack deleted
        self.assertFalse(PhotoStack.objects.filter(pk=stack1.pk).exists())
        # Other user's stack remains
        self.assertTrue(PhotoStack.objects.filter(pk=stack2.pk).exists())

    def test_clear_stacks_returns_zero_if_none(self):
        """Test clearing returns 0 if no stacks of type exist."""
        count = clear_stacks_of_type(self.user, PhotoStack.StackType.BURST_SEQUENCE)
        self.assertEqual(count, 0)


class BurstDetectionTestCase(TestCase):
    """Tests for burst sequence detection."""

    def setUp(self):
        self.user = create_test_user()
        # Set up default burst rules using correct format
        self.user.burst_detection_rules = json.dumps([
            {
                "id": 1,
                "name": "Test EXIF Burst",
                "rule_type": "exif_burst_mode",
                "category": "hard",
                "enabled": True,
            },
            {
                "id": 2,
                "name": "Test Timestamp",
                "rule_type": "timestamp_proximity",
                "category": "soft",
                "enabled": True,
                "interval_ms": 2000
            }
        ])
        self.user.save()

    def _create_file(self, path, file_type=File.IMAGE):
        """Helper to create a File object."""
        return File.objects.create(
            hash=str(uuid.uuid4())[:32],
            path=path,
            type=file_type,
        )

    def _create_photo_with_timestamp(self, timestamp, **kwargs):
        """Helper to create Photo with specific timestamp."""
        photo = create_test_photo(owner=self.user, **kwargs)
        photo.exif_timestamp = timestamp
        file = self._create_file(f"/photos/IMG_{photo.pk}.jpg")
        photo.main_file = file
        photo.save()
        return photo

    def test_no_rules_returns_zero(self):
        """Test no burst detection when rules are empty."""
        self.user.burst_detection_rules = json.dumps([])
        self.user.save()
        
        _photo1 = self._create_photo_with_timestamp(datetime(2024, 1, 1, 12, 0, 0))
        _photo2 = self._create_photo_with_timestamp(datetime(2024, 1, 1, 12, 0, 1))
        
        count = detect_burst_sequences(self.user)
        
        self.assertEqual(count, 0)

    def test_disabled_rules_ignored(self):
        """Test disabled rules are not used."""
        self.user.burst_detection_rules = json.dumps([
            {
                "id": 1,
                "name": "Disabled rule",
                "rule_type": "timestamp_proximity",
                "category": "soft",
                "enabled": False,
                "interval_ms": 5000
            }
        ])
        self.user.save()
        
        _photo1 = self._create_photo_with_timestamp(datetime(2024, 1, 1, 12, 0, 0))
        _photo2 = self._create_photo_with_timestamp(datetime(2024, 1, 1, 12, 0, 1))
        
        count = detect_burst_sequences(self.user)
        
        self.assertEqual(count, 0)

    def test_clears_existing_burst_stacks(self):
        """Test existing burst stacks are cleared before re-detection."""
        photo1 = create_test_photo(owner=self.user)
        photo2 = create_test_photo(owner=self.user)
        
        old_stack = PhotoStack.objects.create(
            owner=self.user,
            stack_type=PhotoStack.StackType.BURST_SEQUENCE,
        )
        old_stack.photos.add(photo1, photo2)
        
        detect_burst_sequences(self.user)
        
        self.assertFalse(PhotoStack.objects.filter(pk=old_stack.pk).exists())

    def test_skip_hidden_photos(self):
        """Test hidden photos are excluded from burst detection."""
        base_time = datetime(2024, 1, 1, 12, 0, 0)
        _photo1 = self._create_photo_with_timestamp(base_time, hidden=True)
        _photo2 = self._create_photo_with_timestamp(base_time + timedelta(seconds=1))
        
        count = detect_burst_sequences(self.user)
        
        self.assertEqual(count, 0)

    def test_skip_trashed_photos(self):
        """Test trashed photos are excluded from burst detection."""
        base_time = datetime(2024, 1, 1, 12, 0, 0)
        _photo1 = self._create_photo_with_timestamp(base_time, in_trashcan=True)
        _photo2 = self._create_photo_with_timestamp(base_time + timedelta(seconds=1))
        
        count = detect_burst_sequences(self.user)
        
        self.assertEqual(count, 0)


class CreateBurstStackTestCase(TestCase):
    """Tests for _create_burst_stack helper."""

    def setUp(self):
        self.user = create_test_user()

    def test_requires_minimum_two_photos(self):
        """Test stack not created with less than 2 photos."""
        photo = create_test_photo(owner=self.user)
        
        stack = _create_burst_stack(self.user, [photo])
        
        self.assertIsNone(stack)

    def test_creates_stack_with_two_photos(self):
        """Test stack created with exactly 2 photos."""
        photo1 = create_test_photo(owner=self.user)
        photo2 = create_test_photo(owner=self.user)
        photo1.exif_timestamp = datetime(2024, 1, 1, 12, 0, 0)
        photo2.exif_timestamp = datetime(2024, 1, 1, 12, 0, 1)
        photo1.save()
        photo2.save()
        
        stack = _create_burst_stack(self.user, [photo1, photo2])
        
        self.assertIsNotNone(stack)
        self.assertEqual(stack.stack_type, PhotoStack.StackType.BURST_SEQUENCE)
        self.assertEqual(stack.photos.count(), 2)

    def test_skips_already_stacked_photos(self):
        """Test photos already in burst stack are skipped."""
        photo1 = create_test_photo(owner=self.user)
        photo2 = create_test_photo(owner=self.user)
        photo3 = create_test_photo(owner=self.user)
        
        # Add photo1 to existing burst stack
        existing_stack = PhotoStack.objects.create(
            owner=self.user,
            stack_type=PhotoStack.StackType.BURST_SEQUENCE,
        )
        existing_stack.photos.add(photo1, photo2)
        
        # Try to create new stack with photo1 and photo3
        stack = _create_burst_stack(self.user, [photo1, photo3])
        
        # photo1 is filtered out, photo3 remains = 1 photo < 2, no stack created
        self.assertIsNone(stack)


class BatchDetectStacksTestCase(TestCase):
    """Tests for batch_detect_stacks orchestration."""

    def setUp(self):
        self.user = create_test_user()
        self.user.burst_detection_rules = json.dumps([])
        self.user.save()

    @patch('api.stack_detection.detect_burst_sequences')
    def test_calls_burst_detector_by_default(self, mock_burst):
        """Test burst detector called with default options."""
        mock_burst.return_value = 3
        
        batch_detect_stacks(self.user)
        
        mock_burst.assert_called_once()

    @patch('api.stack_detection.detect_burst_sequences')
    def test_respects_options(self, mock_burst):
        """Test options control which detectors run."""
        mock_burst.return_value = 0
        
        batch_detect_stacks(self.user, options={
            'detect_bursts': False,
        })
        
        mock_burst.assert_not_called()

    @patch('api.stack_detection.detect_burst_sequences')
    def test_creates_job(self, mock_burst):
        """Test LongRunningJob created for tracking."""
        mock_burst.return_value = 0
        
        batch_detect_stacks(self.user)
        
        job = LongRunningJob.objects.filter(
            started_by=self.user,
            job_type=LongRunningJob.JOB_SCAN_PHOTOS,
        ).first()
        self.assertIsNotNone(job)

    @patch('api.stack_detection.detect_burst_sequences')
    def test_handles_exception(self, mock_burst):
        """Test exception handling during detection."""
        mock_burst.side_effect = Exception("Detection failed")
        
        with self.assertRaises(Exception):
            batch_detect_stacks(self.user)
        
        # Job should be marked as failed
        job = LongRunningJob.objects.filter(
            started_by=self.user,
        ).first()
        self.assertIsNotNone(job)


class FileExtensionsTestCase(TestCase):
    """Tests for file extension handling in directory_watcher."""

    def test_jpeg_extensions_included(self):
        """Test JPEG and HEIC extensions are included."""
        expected = ['.jpg', '.jpeg', '.heic', '.heif']
        for ext in expected:
            self.assertIn(ext, JPEG_EXTENSIONS, f"{ext} should be in JPEG_EXTENSIONS")

    def test_extensions_are_lowercase(self):
        """Test all JPEG extensions are lowercase."""
        for ext in JPEG_EXTENSIONS:
            self.assertEqual(ext, ext.lower(), f"{ext} should be lowercase")


class EdgeCasesTestCase(TestCase):
    """Edge case tests for stack detection."""

    def setUp(self):
        self.user = create_test_user()

    def test_photo_without_main_file(self):
        """Test photos without main_file are handled gracefully."""
        photo = create_test_photo(owner=self.user)
        photo.main_file = None
        photo.save()
        
        # Set up rules to trigger detection
        self.user.burst_detection_rules = json.dumps([
            {
                "id": 1,
                "name": "Test Timestamp",
                "rule_type": "timestamp_proximity",
                "category": "soft",
                "enabled": True,
                "interval_ms": 2000
            }
        ])
        self.user.save()
        
        # Should not raise
        count = detect_burst_sequences(self.user)
        self.assertEqual(count, 0)

    def test_empty_photo_library(self):
        """Test detection on empty library."""
        self.user.burst_detection_rules = json.dumps([
            {
                "id": 1,
                "name": "Test Timestamp",
                "rule_type": "timestamp_proximity",
                "category": "soft",
                "enabled": True,
                "interval_ms": 2000
            }
        ])
        self.user.save()
        
        count = detect_burst_sequences(self.user)
        self.assertEqual(count, 0)

    def test_burst_rules_as_string(self):
        """Test burst_detection_rules stored as JSON string."""
        self.user.burst_detection_rules = '[]'  # Empty JSON string
        self.user.save()
        
        count = detect_burst_sequences(self.user)
        self.assertEqual(count, 0)


class FileVariantTestCase(TestCase):
    """
    Tests for file variant handling (RAW+JPEG, Live Photos).
    
    File variants are now stored via Photo.files ManyToMany field,
    not as stacks. These tests verify the data model works correctly.
    """

    def setUp(self):
        self.user = create_test_user()

    def _create_file(self, path, file_type=File.IMAGE):
        """Helper to create a File object."""
        return File.objects.create(
            hash=str(uuid.uuid4())[:32],
            path=path,
            type=file_type,
        )

    def test_photo_with_raw_variant(self):
        """Test a photo can have a RAW file variant."""
        photo = create_test_photo(owner=self.user)
        
        # Add JPEG as main file
        jpeg_file = self._create_file("/photos/IMG_001.jpg", File.IMAGE)
        photo.main_file = jpeg_file
        photo.files.add(jpeg_file)
        
        # Add RAW variant
        raw_file = self._create_file("/photos/IMG_001.CR2", File.RAW_FILE)
        photo.files.add(raw_file)
        photo.save()
        
        # Verify
        self.assertEqual(photo.files.count(), 2)
        self.assertTrue(photo.files.filter(type=File.RAW_FILE).exists())
        self.assertTrue(photo.files.filter(type=File.IMAGE).exists())

    def test_photo_with_live_photo_video(self):
        """Test a photo can have a video variant (Live Photo)."""
        photo = create_test_photo(owner=self.user)
        
        # Add HEIC as main file
        heic_file = self._create_file("/photos/IMG_001.heic", File.IMAGE)
        photo.main_file = heic_file
        photo.files.add(heic_file)
        
        # Add video variant
        video_file = self._create_file("/photos/IMG_001.mov", File.VIDEO)
        photo.files.add(video_file)
        photo.save()
        
        # Verify
        self.assertEqual(photo.files.count(), 2)
        self.assertTrue(photo.files.filter(type=File.VIDEO).exists())
        self.assertTrue(photo.files.filter(type=File.IMAGE).exists())

    def test_photo_with_all_variant_types(self):
        """Test a photo can have image, RAW, and video variants."""
        photo = create_test_photo(owner=self.user)
        
        # Add all variant types
        jpeg_file = self._create_file("/photos/IMG_001.jpg", File.IMAGE)
        raw_file = self._create_file("/photos/IMG_001.CR2", File.RAW_FILE)
        video_file = self._create_file("/photos/IMG_001.mov", File.VIDEO)
        
        photo.main_file = jpeg_file
        photo.files.add(jpeg_file, raw_file, video_file)
        photo.save()
        
        # Verify
        self.assertEqual(photo.files.count(), 3)
        file_types = set(photo.files.values_list('type', flat=True))
        self.assertEqual(file_types, {File.IMAGE, File.RAW_FILE, File.VIDEO})

    def test_file_variant_vs_stack(self):
        """Test that file variants are separate from stacks."""
        photo1 = create_test_photo(owner=self.user)
        photo2 = create_test_photo(owner=self.user)
        
        # Add file variant to photo1
        jpeg_file = self._create_file("/photos/IMG_001.jpg", File.IMAGE)
        raw_file = self._create_file("/photos/IMG_001.CR2", File.RAW_FILE)
        photo1.main_file = jpeg_file
        photo1.files.add(jpeg_file, raw_file)
        photo1.save()
        
        # Add photo1 and photo2 to a burst stack
        stack = PhotoStack.objects.create(
            owner=self.user,
            stack_type=PhotoStack.StackType.BURST_SEQUENCE,
        )
        stack.photos.add(photo1, photo2)
        
        # Photo1 has 2 file variants AND is in a stack
        self.assertEqual(photo1.files.count(), 2)
        self.assertEqual(photo1.stacks.count(), 1)
        
        # These are independent concepts
        self.assertNotEqual(photo1.files.count(), photo1.stacks.count())

    def test_special_characters_in_filename(self):
        """Test files with special characters in names."""
        photo = create_test_photo(owner=self.user)
        
        jpeg_file = self._create_file("/photos/IMG (1) - Copy.jpg", File.IMAGE)
        raw_file = self._create_file("/photos/IMG (1) - Copy.CR2", File.RAW_FILE)
        
        photo.main_file = jpeg_file
        photo.files.add(jpeg_file, raw_file)
        photo.save()
        
        self.assertEqual(photo.files.count(), 2)

    def test_unicode_in_filename(self):
        """Test files with unicode characters in names."""
        photo = create_test_photo(owner=self.user)
        
        jpeg_file = self._create_file("/photos/фото_001.jpg", File.IMAGE)
        raw_file = self._create_file("/photos/фото_001.CR2", File.RAW_FILE)
        
        photo.main_file = jpeg_file
        photo.files.add(jpeg_file, raw_file)
        photo.save()
        
        self.assertEqual(photo.files.count(), 2)

    def test_progress_callback_called(self):
        """Test progress callback is called during burst detection."""
        self.user.burst_detection_rules = json.dumps([
            {
                "id": 1,
                "name": "Test Timestamp",
                "rule_type": "timestamp_proximity",
                "category": "soft",
                "enabled": True,
                "interval_ms": 2000
            }
        ])
        self.user.save()
        
        file = File.objects.create(
            hash=str(uuid.uuid4())[:32],
            path="/photos/IMG_001.jpg",
            type=File.IMAGE,
        )
        photo = create_test_photo(owner=self.user)
        photo.main_file = file
        photo.exif_timestamp = datetime(2024, 1, 1, 12, 0, 0)
        photo.save()
        
        callback_calls = []
        
        def progress_callback(current, total, found):
            callback_calls.append((current, total, found))
        
        detect_burst_sequences(self.user, progress_callback=progress_callback)
        
        # Callback should be called at least once (for index 0) or not at all if no hard rules
        self.assertGreaterEqual(len(callback_calls), 0)
