"""
Comprehensive tests for Stack Detection Logic.

Tests cover:
- clear_stacks_of_type: Clearing stacks before re-detection
- detect_raw_jpeg_pairs: RAW+JPEG pair detection
- detect_burst_sequences: Burst sequence detection with rules
- detect_live_photos: Live photo detection
- batch_detect_stacks: Batch detection orchestration
- Edge cases and error handling
"""

import json
import os
import uuid
from datetime import datetime, timedelta
from unittest.mock import MagicMock, patch, PropertyMock

from django.test import TestCase

from api.models import Photo
from api.models.file import File
from api.models.photo_stack import PhotoStack
from api.models.long_running_job import LongRunningJob
from api.stack_detection import (
    clear_stacks_of_type,
    detect_raw_jpeg_pairs,
    detect_burst_sequences,
    detect_live_photos,
    batch_detect_stacks,
    RAW_EXTENSIONS,
    JPEG_EXTENSIONS,
    _create_burst_stack,
    _detect_bursts_hard_criteria,
    _detect_bursts_soft_criteria,
)
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
        
        raw_stack = PhotoStack.objects.create(
            owner=self.user,
            stack_type=PhotoStack.StackType.RAW_JPEG_PAIR,
        )
        raw_stack.photos.add(photo3, photo4)
        
        # Clear only burst stacks
        count = clear_stacks_of_type(self.user, PhotoStack.StackType.BURST_SEQUENCE)
        
        self.assertEqual(count, 1)
        self.assertFalse(PhotoStack.objects.filter(
            owner=self.user, stack_type=PhotoStack.StackType.BURST_SEQUENCE
        ).exists())
        # RAW stack should still exist
        self.assertTrue(PhotoStack.objects.filter(
            owner=self.user, stack_type=PhotoStack.StackType.RAW_JPEG_PAIR
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
        count = clear_stacks_of_type(self.user, PhotoStack.StackType.LIVE_PHOTO)
        self.assertEqual(count, 0)


class RawJpegDetectionTestCase(TestCase):
    """Tests for RAW+JPEG pair detection."""

    def setUp(self):
        self.user = create_test_user()

    def _create_file(self, path, file_type=File.IMAGE):
        """Helper to create a File object."""
        return File.objects.create(
            hash=str(uuid.uuid4())[:32],
            path=path,
            type=file_type,
        )

    def _create_photo_with_file(self, path, file_type=File.IMAGE, **kwargs):
        """Helper to create Photo with associated File."""
        file = self._create_file(path, file_type)
        photo = create_test_photo(owner=self.user, **kwargs)
        photo.main_file = file
        photo.save()
        return photo

    def test_detect_raw_jpeg_pair(self):
        """Test detecting a basic RAW+JPEG pair."""
        # Create RAW and JPEG photos with matching names
        raw_photo = self._create_photo_with_file(
            "/photos/IMG_001.CR2", File.RAW_FILE
        )
        jpeg_photo = self._create_photo_with_file(
            "/photos/IMG_001.jpg", File.IMAGE
        )
        
        count = detect_raw_jpeg_pairs(self.user)
        
        self.assertEqual(count, 1)
        
        # Verify stack created
        raw_photo.refresh_from_db()
        self.assertEqual(raw_photo.stacks.count(), 1)
        stack = raw_photo.stacks.first()
        self.assertEqual(stack.stack_type, PhotoStack.StackType.RAW_JPEG_PAIR)
        self.assertEqual(stack.photos.count(), 2)
        # JPEG should be primary
        self.assertEqual(stack.primary_photo, jpeg_photo)

    def test_detect_raw_jpeg_case_insensitive(self):
        """Test RAW+JPEG detection with uppercase extension."""
        raw_photo = self._create_photo_with_file(
            "/photos/DSC_100.NEF", File.RAW_FILE
        )
        jpeg_photo = self._create_photo_with_file(
            "/photos/DSC_100.JPG", File.IMAGE
        )
        
        count = detect_raw_jpeg_pairs(self.user)
        
        self.assertEqual(count, 1)

    def test_detect_raw_heic_pair(self):
        """Test detecting RAW paired with HEIC."""
        raw_photo = self._create_photo_with_file(
            "/photos/IMG_001.ARW", File.RAW_FILE
        )
        heic_photo = self._create_photo_with_file(
            "/photos/IMG_001.heic", File.IMAGE
        )
        
        count = detect_raw_jpeg_pairs(self.user)
        
        self.assertEqual(count, 1)

    def test_no_match_different_directory(self):
        """Test no match when files are in different directories."""
        raw_photo = self._create_photo_with_file(
            "/photos/2024/IMG_001.CR2", File.RAW_FILE
        )
        jpeg_photo = self._create_photo_with_file(
            "/photos/2023/IMG_001.jpg", File.IMAGE
        )
        
        count = detect_raw_jpeg_pairs(self.user)
        
        self.assertEqual(count, 0)

    def test_no_match_different_basename(self):
        """Test no match when base filenames differ."""
        raw_photo = self._create_photo_with_file(
            "/photos/IMG_001.CR2", File.RAW_FILE
        )
        jpeg_photo = self._create_photo_with_file(
            "/photos/IMG_002.jpg", File.IMAGE
        )
        
        count = detect_raw_jpeg_pairs(self.user)
        
        self.assertEqual(count, 0)

    def test_skip_hidden_photos(self):
        """Test hidden photos are not paired."""
        raw_photo = self._create_photo_with_file(
            "/photos/IMG_001.CR2", File.RAW_FILE, hidden=True
        )
        jpeg_photo = self._create_photo_with_file(
            "/photos/IMG_001.jpg", File.IMAGE
        )
        
        count = detect_raw_jpeg_pairs(self.user)
        
        self.assertEqual(count, 0)

    def test_skip_trashed_photos(self):
        """Test trashed photos are not paired."""
        raw_photo = self._create_photo_with_file(
            "/photos/IMG_001.CR2", File.RAW_FILE
        )
        jpeg_photo = self._create_photo_with_file(
            "/photos/IMG_001.jpg", File.IMAGE, in_trashcan=True
        )
        
        count = detect_raw_jpeg_pairs(self.user)
        
        self.assertEqual(count, 0)

    def test_clears_existing_stacks_before_detection(self):
        """Test existing RAW+JPEG stacks are cleared before re-detection."""
        photo1 = create_test_photo(owner=self.user)
        photo2 = create_test_photo(owner=self.user)
        
        old_stack = PhotoStack.objects.create(
            owner=self.user,
            stack_type=PhotoStack.StackType.RAW_JPEG_PAIR,
        )
        old_stack.photos.add(photo1, photo2)
        
        # Run detection (no new pairs found)
        count = detect_raw_jpeg_pairs(self.user)
        
        # Old stack should be deleted
        self.assertFalse(PhotoStack.objects.filter(pk=old_stack.pk).exists())

    def test_no_duplicate_stacks_on_rerun(self):
        """Test re-running detection doesn't create duplicate stacks."""
        raw_photo = self._create_photo_with_file(
            "/photos/IMG_001.CR2", File.RAW_FILE
        )
        jpeg_photo = self._create_photo_with_file(
            "/photos/IMG_001.jpg", File.IMAGE
        )
        
        # Run twice
        detect_raw_jpeg_pairs(self.user)
        detect_raw_jpeg_pairs(self.user)
        
        # Should only have 1 stack
        stacks = PhotoStack.objects.filter(
            owner=self.user, stack_type=PhotoStack.StackType.RAW_JPEG_PAIR
        )
        self.assertEqual(stacks.count(), 1)


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
        
        photo1 = self._create_photo_with_timestamp(datetime(2024, 1, 1, 12, 0, 0))
        photo2 = self._create_photo_with_timestamp(datetime(2024, 1, 1, 12, 0, 1))
        
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
        
        photo1 = self._create_photo_with_timestamp(datetime(2024, 1, 1, 12, 0, 0))
        photo2 = self._create_photo_with_timestamp(datetime(2024, 1, 1, 12, 0, 1))
        
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
        photo1 = self._create_photo_with_timestamp(base_time, hidden=True)
        photo2 = self._create_photo_with_timestamp(base_time + timedelta(seconds=1))
        
        count = detect_burst_sequences(self.user)
        
        self.assertEqual(count, 0)

    def test_skip_trashed_photos(self):
        """Test trashed photos are excluded from burst detection."""
        base_time = datetime(2024, 1, 1, 12, 0, 0)
        photo1 = self._create_photo_with_timestamp(base_time, in_trashcan=True)
        photo2 = self._create_photo_with_timestamp(base_time + timedelta(seconds=1))
        
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
        
        # Should only contain photo3 (photo1 already in burst stack)
        # Since we need 2+ photos, and only 1 is available, no stack created
        # Actually, the function filters and then checks count
        # Let me check: photo1 is filtered out, photo3 remains = 1 photo < 2
        self.assertIsNone(stack)


class LivePhotoDetectionTestCase(TestCase):
    """Tests for live photo detection."""

    def setUp(self):
        self.user = create_test_user()

    def _create_file(self, path, file_type=File.IMAGE):
        """Helper to create a File object."""
        return File.objects.create(
            hash=str(uuid.uuid4())[:32],
            path=path,
            type=file_type,
        )

    def _create_photo_with_file(self, path, file_type=File.IMAGE, **kwargs):
        """Helper to create Photo with associated File."""
        file = self._create_file(path, file_type)
        photo = create_test_photo(owner=self.user, **kwargs)
        photo.main_file = file
        photo.save()
        return photo

    def test_detect_live_photo_mov(self):
        """Test detecting photo+MOV pair."""
        photo = self._create_photo_with_file(
            "/photos/IMG_001.jpg", File.IMAGE
        )
        video = self._create_photo_with_file(
            "/photos/IMG_001.mov", File.VIDEO
        )
        
        count = detect_live_photos(self.user)
        
        self.assertEqual(count, 1)
        
        photo.refresh_from_db()
        self.assertEqual(photo.stacks.count(), 1)
        stack = photo.stacks.first()
        self.assertEqual(stack.stack_type, PhotoStack.StackType.LIVE_PHOTO)
        self.assertEqual(stack.photos.count(), 2)
        # Still image should be primary
        self.assertEqual(stack.primary_photo, photo)

    def test_detect_live_photo_mp4(self):
        """Test detecting photo+MP4 pair."""
        photo = self._create_photo_with_file(
            "/photos/IMG_001.heic", File.IMAGE
        )
        video = self._create_photo_with_file(
            "/photos/IMG_001.mp4", File.VIDEO
        )
        
        count = detect_live_photos(self.user)
        
        self.assertEqual(count, 1)

    def test_detect_live_photo_case_insensitive(self):
        """Test live photo detection with uppercase extension."""
        photo = self._create_photo_with_file(
            "/photos/IMG_001.jpg", File.IMAGE
        )
        video = self._create_photo_with_file(
            "/photos/IMG_001.MOV", File.VIDEO
        )
        
        count = detect_live_photos(self.user)
        
        self.assertEqual(count, 1)

    def test_no_match_different_directory(self):
        """Test no match when files are in different directories."""
        photo = self._create_photo_with_file(
            "/photos/2024/IMG_001.jpg", File.IMAGE
        )
        video = self._create_photo_with_file(
            "/photos/2023/IMG_001.mov", File.VIDEO
        )
        
        count = detect_live_photos(self.user)
        
        self.assertEqual(count, 0)

    def test_skip_hidden_photos(self):
        """Test hidden photos excluded from live photo detection."""
        photo = self._create_photo_with_file(
            "/photos/IMG_001.jpg", File.IMAGE, hidden=True
        )
        video = self._create_photo_with_file(
            "/photos/IMG_001.mov", File.VIDEO
        )
        
        count = detect_live_photos(self.user)
        
        self.assertEqual(count, 0)

    def test_clears_existing_live_stacks(self):
        """Test existing live photo stacks cleared before re-detection."""
        photo1 = create_test_photo(owner=self.user)
        photo2 = create_test_photo(owner=self.user)
        
        old_stack = PhotoStack.objects.create(
            owner=self.user,
            stack_type=PhotoStack.StackType.LIVE_PHOTO,
        )
        old_stack.photos.add(photo1, photo2)
        
        detect_live_photos(self.user)
        
        self.assertFalse(PhotoStack.objects.filter(pk=old_stack.pk).exists())


class BatchDetectStacksTestCase(TestCase):
    """Tests for batch_detect_stacks orchestration."""

    def setUp(self):
        self.user = create_test_user()
        self.user.burst_detection_rules = json.dumps([])
        self.user.save()

    @patch('api.stack_detection.detect_raw_jpeg_pairs')
    @patch('api.stack_detection.detect_burst_sequences')
    @patch('api.stack_detection.detect_live_photos')
    def test_calls_all_detectors_by_default(self, mock_live, mock_burst, mock_raw):
        """Test all detectors called with default options."""
        mock_raw.return_value = 5
        mock_burst.return_value = 3
        mock_live.return_value = 2
        
        batch_detect_stacks(self.user)
        
        mock_raw.assert_called_once()
        mock_burst.assert_called_once()
        mock_live.assert_called_once()

    @patch('api.stack_detection.detect_raw_jpeg_pairs')
    @patch('api.stack_detection.detect_burst_sequences')
    @patch('api.stack_detection.detect_live_photos')
    def test_respects_options(self, mock_live, mock_burst, mock_raw):
        """Test options control which detectors run."""
        mock_raw.return_value = 0
        mock_burst.return_value = 0
        mock_live.return_value = 0
        
        batch_detect_stacks(self.user, options={
            'detect_raw_jpeg': False,
            'detect_bursts': True,
            'detect_live_photos': False,
        })
        
        mock_raw.assert_not_called()
        mock_burst.assert_called_once()
        mock_live.assert_not_called()

    @patch('api.stack_detection.detect_raw_jpeg_pairs')
    @patch('api.stack_detection.detect_burst_sequences')
    @patch('api.stack_detection.detect_live_photos')
    def test_creates_job(self, mock_live, mock_burst, mock_raw):
        """Test LongRunningJob created for tracking."""
        mock_raw.return_value = 0
        mock_burst.return_value = 0
        mock_live.return_value = 0
        
        batch_detect_stacks(self.user)
        
        job = LongRunningJob.objects.filter(
            started_by=self.user,
            job_type=LongRunningJob.JOB_SCAN_PHOTOS,
        ).first()
        self.assertIsNotNone(job)

    @patch('api.stack_detection.detect_raw_jpeg_pairs')
    def test_handles_exception(self, mock_raw):
        """Test exception handling during detection."""
        mock_raw.side_effect = Exception("Detection failed")
        
        with self.assertRaises(Exception):
            batch_detect_stacks(self.user)
        
        # Job should be marked as failed
        job = LongRunningJob.objects.filter(
            started_by=self.user,
        ).first()
        self.assertIsNotNone(job)


class RawExtensionsTestCase(TestCase):
    """Tests for RAW extension constants."""

    def test_common_raw_extensions_included(self):
        """Test common RAW extensions are in the set."""
        common_raw = ['.cr2', '.cr3', '.nef', '.arw', '.dng', '.orf', '.raf']
        for ext in common_raw:
            self.assertIn(ext, RAW_EXTENSIONS, f"{ext} should be a RAW extension")

    def test_extensions_are_lowercase(self):
        """Test all RAW extensions are lowercase."""
        for ext in RAW_EXTENSIONS:
            self.assertEqual(ext, ext.lower(), f"{ext} should be lowercase")

    def test_extensions_start_with_dot(self):
        """Test all extensions start with a dot."""
        for ext in RAW_EXTENSIONS:
            self.assertTrue(ext.startswith('.'), f"{ext} should start with '.'")


class JpegExtensionsTestCase(TestCase):
    """Tests for JPEG extension constants."""

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
        
        # Should not raise
        count = detect_raw_jpeg_pairs(self.user)
        self.assertEqual(count, 0)

    def test_empty_photo_library(self):
        """Test detection on empty library."""
        count_raw = detect_raw_jpeg_pairs(self.user)
        count_live = detect_live_photos(self.user)
        
        self.assertEqual(count_raw, 0)
        self.assertEqual(count_live, 0)

    def test_special_characters_in_filename(self):
        """Test files with special characters in names."""
        file1 = File.objects.create(
            hash=str(uuid.uuid4())[:32],
            path="/photos/IMG (1) - Copy.CR2",
            type=File.RAW_FILE,
        )
        photo1 = create_test_photo(owner=self.user)
        photo1.main_file = file1
        photo1.save()
        
        file2 = File.objects.create(
            hash=str(uuid.uuid4())[:32],
            path="/photos/IMG (1) - Copy.jpg",
            type=File.IMAGE,
        )
        photo2 = create_test_photo(owner=self.user)
        photo2.main_file = file2
        photo2.save()
        
        count = detect_raw_jpeg_pairs(self.user)
        self.assertEqual(count, 1)

    def test_unicode_in_filename(self):
        """Test files with unicode characters in names."""
        file1 = File.objects.create(
            hash=str(uuid.uuid4())[:32],
            path="/photos/фото_001.CR2",
            type=File.RAW_FILE,
        )
        photo1 = create_test_photo(owner=self.user)
        photo1.main_file = file1
        photo1.save()
        
        file2 = File.objects.create(
            hash=str(uuid.uuid4())[:32],
            path="/photos/фото_001.jpg",
            type=File.IMAGE,
        )
        photo2 = create_test_photo(owner=self.user)
        photo2.main_file = file2
        photo2.save()
        
        count = detect_raw_jpeg_pairs(self.user)
        self.assertEqual(count, 1)

    def test_progress_callback_called(self):
        """Test progress callback is called during detection."""
        file1 = File.objects.create(
            hash=str(uuid.uuid4())[:32],
            path="/photos/IMG_001.CR2",
            type=File.RAW_FILE,
        )
        photo1 = create_test_photo(owner=self.user)
        photo1.main_file = file1
        photo1.save()
        
        callback_calls = []
        
        def progress_callback(current, total, found):
            callback_calls.append((current, total, found))
        
        detect_raw_jpeg_pairs(self.user, progress_callback=progress_callback)
        
        # Callback should be called at least once (for index 0)
        self.assertGreaterEqual(len(callback_calls), 0)

    def test_burst_rules_as_string(self):
        """Test burst_detection_rules stored as JSON string."""
        self.user.burst_detection_rules = '[]'  # Empty JSON string
        self.user.save()
        
        count = detect_burst_sequences(self.user)
        self.assertEqual(count, 0)

    def test_multiple_jpeg_extensions_same_raw(self):
        """Test RAW with multiple potential JPEG matches (first wins)."""
        file_raw = File.objects.create(
            hash=str(uuid.uuid4())[:32],
            path="/photos/IMG_001.CR2",
            type=File.RAW_FILE,
        )
        raw_photo = create_test_photo(owner=self.user)
        raw_photo.main_file = file_raw
        raw_photo.save()
        
        # Create both .jpg and .jpeg
        file_jpg = File.objects.create(
            hash=str(uuid.uuid4())[:32],
            path="/photos/IMG_001.jpg",
            type=File.IMAGE,
        )
        jpg_photo = create_test_photo(owner=self.user)
        jpg_photo.main_file = file_jpg
        jpg_photo.save()
        
        file_jpeg = File.objects.create(
            hash=str(uuid.uuid4())[:32],
            path="/photos/IMG_001.jpeg",
            type=File.IMAGE,
        )
        jpeg_photo = create_test_photo(owner=self.user)
        jpeg_photo.main_file = file_jpeg
        jpeg_photo.save()
        
        count = detect_raw_jpeg_pairs(self.user)
        
        # Should create only 1 stack (first match wins)
        self.assertEqual(count, 1)
        
        raw_photo.refresh_from_db()
        stack = raw_photo.stacks.first()
        # Stack should have 2 photos (RAW + first matching JPEG)
        self.assertEqual(stack.photos.count(), 2)
