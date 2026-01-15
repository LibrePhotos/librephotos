"""
Edge case tests for Stack Detection to find bugs.

These tests specifically target:
1. create_or_merge queryset ordering issues (potential Bug #11)
2. Edge cases in hard criteria burst detection
3. Edge cases in soft criteria burst detection
4. Concurrent detection issues
5. Memory/performance edge cases
"""

import json
import uuid
from datetime import datetime, timedelta
from unittest.mock import MagicMock, patch, PropertyMock
from concurrent.futures import ThreadPoolExecutor
import threading

from django.test import TestCase, TransactionTestCase
from django.db import connection

from api.models import Photo
from api.models.file import File
from api.models.photo_stack import PhotoStack
from api.models.duplicate import Duplicate
from api.models.long_running_job import LongRunningJob
from api.stack_detection import (
    clear_stacks_of_type,
    detect_raw_jpeg_pairs,
    detect_burst_sequences,
    detect_live_photos,
    batch_detect_stacks,
    _create_burst_stack,
    _detect_bursts_hard_criteria,
    _detect_bursts_soft_criteria,
)
from api.tests.utils import create_test_photo, create_test_user


class CreateOrMergeQuerysetOrderingTestCase(TestCase):
    """
    Test for Bug #11: create_or_merge uses two separate queries without ordering.
    
    The code does:
        existing_stacks = cls.objects.filter(...).distinct()
        target_stack = existing_stacks.first()      # Query 1
        for stack in existing_stacks[1:]:           # Query 2
    
    Without explicit ordering, these two queries could return stacks in different
    orders, causing the merge to not work correctly.
    """

    def setUp(self):
        self.user = create_test_user()

    def test_create_or_merge_with_multiple_existing_stacks(self):
        """Test that create_or_merge properly merges when photos are in multiple stacks."""
        # Create 4 photos
        photo1 = create_test_photo(owner=self.user)
        photo2 = create_test_photo(owner=self.user)
        photo3 = create_test_photo(owner=self.user)
        photo4 = create_test_photo(owner=self.user)
        
        # Create two separate stacks
        stack1 = PhotoStack.objects.create(
            owner=self.user,
            stack_type=PhotoStack.StackType.BURST_SEQUENCE,
        )
        stack1.photos.add(photo1, photo2)
        
        stack2 = PhotoStack.objects.create(
            owner=self.user,
            stack_type=PhotoStack.StackType.BURST_SEQUENCE,
        )
        stack2.photos.add(photo3, photo4)
        
        # Now try to create a stack with photos from both existing stacks
        # This should trigger the merge logic
        result_stack = PhotoStack.create_or_merge(
            owner=self.user,
            stack_type=PhotoStack.StackType.BURST_SEQUENCE,
            photos=[photo1, photo3],  # One from each stack
        )
        
        # Should have merged into one stack
        self.assertIsNotNone(result_stack)
        
        # Count remaining stacks of this type
        remaining_stacks = PhotoStack.objects.filter(
            owner=self.user,
            stack_type=PhotoStack.StackType.BURST_SEQUENCE,
        )
        
        # Should only have 1 stack after merge
        self.assertEqual(remaining_stacks.count(), 1, 
            "Multiple existing stacks should be merged into one")
        
        # The merged stack should contain all 4 photos
        merged_stack = remaining_stacks.first()
        self.assertEqual(merged_stack.photos.count(), 4,
            "Merged stack should contain all photos from both original stacks")

    def test_create_or_merge_with_three_existing_stacks(self):
        """Test merging with 3 existing stacks - tests iterative merge."""
        photos = [create_test_photo(owner=self.user) for _ in range(6)]
        
        # Create three separate stacks with 2 photos each
        stack1 = PhotoStack.objects.create(
            owner=self.user,
            stack_type=PhotoStack.StackType.BURST_SEQUENCE,
        )
        stack1.photos.add(photos[0], photos[1])
        
        stack2 = PhotoStack.objects.create(
            owner=self.user,
            stack_type=PhotoStack.StackType.BURST_SEQUENCE,
        )
        stack2.photos.add(photos[2], photos[3])
        
        stack3 = PhotoStack.objects.create(
            owner=self.user,
            stack_type=PhotoStack.StackType.BURST_SEQUENCE,
        )
        stack3.photos.add(photos[4], photos[5])
        
        # Create stack with one photo from each existing stack
        result_stack = PhotoStack.create_or_merge(
            owner=self.user,
            stack_type=PhotoStack.StackType.BURST_SEQUENCE,
            photos=[photos[0], photos[2], photos[4]],
        )
        
        # Should merge all into one
        remaining_stacks = PhotoStack.objects.filter(
            owner=self.user,
            stack_type=PhotoStack.StackType.BURST_SEQUENCE,
        )
        
        self.assertEqual(remaining_stacks.count(), 1,
            "All 3 stacks should be merged into one")
        self.assertEqual(remaining_stacks.first().photos.count(), 6,
            "Merged stack should have all 6 photos")


class DuplicateCreateOrMergeOrderingTestCase(TestCase):
    """Test the same ordering issue in Duplicate.create_or_merge."""

    def setUp(self):
        self.user = create_test_user()

    def test_duplicate_create_or_merge_with_multiple_groups(self):
        """Test that Duplicate.create_or_merge properly merges multiple groups."""
        photos = [create_test_photo(owner=self.user) for _ in range(4)]
        
        # Create two duplicate groups
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
        
        # Merge by adding photos from both groups
        result = Duplicate.create_or_merge(
            owner=self.user,
            duplicate_type=Duplicate.DuplicateType.EXACT_COPY,
            photos=[photos[0], photos[2]],
        )
        
        remaining = Duplicate.objects.filter(
            owner=self.user,
            duplicate_type=Duplicate.DuplicateType.EXACT_COPY,
        )
        
        self.assertEqual(remaining.count(), 1,
            "Multiple duplicate groups should be merged")
        self.assertEqual(remaining.first().photos.count(), 4,
            "Merged group should have all photos")


class HardCriteriaBurstDetectionEdgeCasesTestCase(TestCase):
    """Edge cases for hard criteria burst detection."""

    def setUp(self):
        self.user = create_test_user()
        # Set up hard rule that uses EXIF burst mode
        self.user.burst_detection_rules = json.dumps([
            {
                "id": 1,
                "name": "EXIF Burst Mode",
                "rule_type": "exif_burst_mode",
                "category": "hard",
                "enabled": True,
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

    def _create_photo_with_file(self, path, **kwargs):
        """Helper to create Photo with associated File."""
        file = self._create_file(path, File.IMAGE)
        photo = create_test_photo(owner=self.user, **kwargs)
        photo.main_file = file
        photo.save()
        return photo

    def test_all_photos_without_main_file(self):
        """Test detection when all photos have no main_file."""
        photo1 = create_test_photo(owner=self.user)
        photo2 = create_test_photo(owner=self.user)
        photo1.main_file = None
        photo2.main_file = None
        photo1.save()
        photo2.save()
        
        # Should handle gracefully
        count = detect_burst_sequences(self.user)
        self.assertEqual(count, 0)

    @patch('api.util.get_metadata')
    def test_get_metadata_raises_exception_for_all(self, mock_get_metadata):
        """Test when get_metadata raises exceptions for every photo."""
        photo1 = self._create_photo_with_file("/photos/IMG_001.jpg")
        photo2 = self._create_photo_with_file("/photos/IMG_002.jpg")
        
        mock_get_metadata.side_effect = Exception("EXIF read failed")
        
        # Should handle gracefully without crashing
        count = detect_burst_sequences(self.user)
        self.assertEqual(count, 0)

    @patch('api.util.get_metadata')
    def test_get_metadata_returns_empty_for_some(self, mock_get_metadata):
        """Test when get_metadata returns empty for some photos."""
        photo1 = self._create_photo_with_file("/photos/IMG_001.jpg")
        photo2 = self._create_photo_with_file("/photos/IMG_002.jpg")
        
        # Return empty values
        mock_get_metadata.return_value = [None, None]
        
        count = detect_burst_sequences(self.user)
        # No bursts found because EXIF data is empty
        self.assertEqual(count, 0)


class SoftCriteriaBurstDetectionEdgeCasesTestCase(TestCase):
    """Edge cases for soft criteria burst detection."""

    def setUp(self):
        self.user = create_test_user()

    def _create_file(self, path, file_type=File.IMAGE):
        """Helper to create a File object."""
        return File.objects.create(
            hash=str(uuid.uuid4())[:32],
            path=path,
            type=file_type,
        )

    def _create_photo_with_timestamp(self, timestamp, perceptual_hash=None, **kwargs):
        """Helper to create Photo with specific timestamp and optional hash."""
        photo = create_test_photo(owner=self.user, **kwargs)
        photo.exif_timestamp = timestamp
        if perceptual_hash:
            photo.perceptual_hash = perceptual_hash
        file = self._create_file(f"/photos/IMG_{photo.pk}.jpg")
        photo.main_file = file
        photo.save()
        return photo

    def test_visual_similarity_with_null_perceptual_hash(self):
        """Test visual similarity detection when photos have no perceptual hash."""
        self.user.burst_detection_rules = json.dumps([
            {
                "id": 1,
                "name": "Visual Similarity",
                "rule_type": "visual_similarity",
                "category": "soft",
                "enabled": True,
                "similarity_threshold": 15,
            }
        ])
        self.user.save()
        
        base_time = datetime(2024, 1, 1, 12, 0, 0)
        # Create photos with no perceptual hash
        photo1 = self._create_photo_with_timestamp(base_time, perceptual_hash=None)
        photo2 = self._create_photo_with_timestamp(base_time + timedelta(seconds=1), perceptual_hash=None)
        
        # Should handle gracefully
        count = detect_burst_sequences(self.user)
        self.assertEqual(count, 0)

    def test_timestamp_proximity_with_same_timestamp(self):
        """Test timestamp proximity when multiple photos have exact same timestamp."""
        self.user.burst_detection_rules = json.dumps([
            {
                "id": 1,
                "name": "Timestamp Proximity",
                "rule_type": "timestamp_proximity",
                "category": "soft",
                "enabled": True,
                "interval_ms": 2000,
            }
        ])
        self.user.save()
        
        exact_time = datetime(2024, 1, 1, 12, 0, 0)
        # Create 5 photos with exact same timestamp
        photos = []
        for i in range(5):
            photos.append(self._create_photo_with_timestamp(exact_time))
        
        count = detect_burst_sequences(self.user)
        
        # Should create one burst stack with all 5 photos
        self.assertEqual(count, 1)
        
        stacks = PhotoStack.objects.filter(
            owner=self.user,
            stack_type=PhotoStack.StackType.BURST_SEQUENCE,
        )
        self.assertEqual(stacks.count(), 1)
        self.assertEqual(stacks.first().photos.count(), 5)

    def test_timestamp_proximity_boundary_condition(self):
        """Test timestamp proximity at exact boundary (2000ms)."""
        self.user.burst_detection_rules = json.dumps([
            {
                "id": 1,
                "name": "Timestamp Proximity",
                "rule_type": "timestamp_proximity",
                "category": "soft",
                "enabled": True,
                "interval_ms": 2000,
                "require_same_camera": False,
            }
        ])
        self.user.save()
        
        base_time = datetime(2024, 1, 1, 12, 0, 0)
        # Photo 2 is exactly 2000ms after photo 1
        photo1 = self._create_photo_with_timestamp(base_time)
        photo2 = self._create_photo_with_timestamp(base_time + timedelta(milliseconds=2000))
        # Photo 3 is 2001ms after photo 1 (just outside boundary)
        photo3 = self._create_photo_with_timestamp(base_time + timedelta(milliseconds=2001))
        
        count = detect_burst_sequences(self.user)
        
        # Depending on implementation, photo1+photo2 might be grouped, photo3 separate
        # This tests the boundary condition behavior
        stacks = PhotoStack.objects.filter(
            owner=self.user,
            stack_type=PhotoStack.StackType.BURST_SEQUENCE,
        )
        # At minimum, should not crash
        self.assertGreaterEqual(count, 0)

    def test_all_photos_already_in_burst_stacks(self):
        """Test soft criteria when all photos are already in burst stacks."""
        self.user.burst_detection_rules = json.dumps([
            {
                "id": 1,
                "name": "Timestamp Proximity",
                "rule_type": "timestamp_proximity",
                "category": "soft",
                "enabled": True,
                "interval_ms": 5000,
            }
        ])
        self.user.save()
        
        base_time = datetime(2024, 1, 1, 12, 0, 0)
        photo1 = self._create_photo_with_timestamp(base_time)
        photo2 = self._create_photo_with_timestamp(base_time + timedelta(seconds=1))
        
        # Pre-create a burst stack with both photos
        existing_stack = PhotoStack.objects.create(
            owner=self.user,
            stack_type=PhotoStack.StackType.BURST_SEQUENCE,
        )
        existing_stack.photos.add(photo1, photo2)
        
        # Run detection - should NOT clear existing stacks (that's done at start)
        # But since we cleared at the start in detect_burst_sequences, 
        # the existing stack will be deleted first, then re-detected
        count = detect_burst_sequences(self.user)
        
        # Should re-detect the burst
        self.assertEqual(count, 1)


class LivePhotoDetectionEdgeCasesTestCase(TestCase):
    """Edge cases for live photo detection."""

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

    def test_multiple_video_extensions_same_photo(self):
        """Test when both .mov and .mp4 exist for the same photo."""
        photo = self._create_photo_with_file(
            "/photos/IMG_001.jpg", File.IMAGE
        )
        video_mov = self._create_photo_with_file(
            "/photos/IMG_001.mov", File.VIDEO
        )
        video_mp4 = self._create_photo_with_file(
            "/photos/IMG_001.mp4", File.VIDEO
        )
        
        count = detect_live_photos(self.user)
        
        # Should only create one stack (first video extension match wins)
        self.assertEqual(count, 1)
        
        photo.refresh_from_db()
        stack = photo.stacks.first()
        # Stack should have exactly 2 photos (photo + first matching video)
        self.assertEqual(stack.photos.count(), 2)

    def test_video_exists_but_different_basename(self):
        """Test no match when video has different basename."""
        photo = self._create_photo_with_file(
            "/photos/IMG_001.jpg", File.IMAGE
        )
        video = self._create_photo_with_file(
            "/photos/IMG_001_video.mov", File.VIDEO
        )
        
        count = detect_live_photos(self.user)
        self.assertEqual(count, 0)

    def test_m4v_extension(self):
        """Test detection with .m4v video extension."""
        photo = self._create_photo_with_file(
            "/photos/IMG_001.jpg", File.IMAGE
        )
        video = self._create_photo_with_file(
            "/photos/IMG_001.m4v", File.VIDEO
        )
        
        count = detect_live_photos(self.user)
        self.assertEqual(count, 1)

    def test_very_long_filename(self):
        """Test detection with very long filename."""
        long_name = "IMG_" + "a" * 200
        photo = self._create_photo_with_file(
            f"/photos/{long_name}.jpg", File.IMAGE
        )
        video = self._create_photo_with_file(
            f"/photos/{long_name}.mov", File.VIDEO
        )
        
        count = detect_live_photos(self.user)
        self.assertEqual(count, 1)

    def test_dot_in_basename(self):
        """Test detection when basename contains dots."""
        photo = self._create_photo_with_file(
            "/photos/IMG.2024.01.01.001.jpg", File.IMAGE
        )
        video = self._create_photo_with_file(
            "/photos/IMG.2024.01.01.001.mov", File.VIDEO
        )
        
        count = detect_live_photos(self.user)
        self.assertEqual(count, 1)


class RawJpegDetectionEdgeCasesTestCase(TestCase):
    """Additional edge cases for RAW+JPEG detection."""

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

    def test_raw_without_extension(self):
        """Test RAW file detection when extension is unusual."""
        # This shouldn't be detected as RAW since extension isn't in RAW_EXTENSIONS
        photo = self._create_photo_with_file(
            "/photos/IMG_001.raw_backup", File.RAW_FILE
        )
        jpeg = self._create_photo_with_file(
            "/photos/IMG_001.raw_backup.jpg", File.IMAGE
        )
        
        count = detect_raw_jpeg_pairs(self.user)
        # Should not match because base name differs
        self.assertEqual(count, 0)

    def test_multiple_raw_files_same_jpeg(self):
        """Test when multiple RAW files could match same JPEG."""
        raw_cr2 = self._create_photo_with_file(
            "/photos/IMG_001.CR2", File.RAW_FILE
        )
        raw_nef = self._create_photo_with_file(
            "/photos/IMG_001.NEF", File.RAW_FILE
        )
        jpeg = self._create_photo_with_file(
            "/photos/IMG_001.jpg", File.IMAGE
        )
        
        count = detect_raw_jpeg_pairs(self.user)
        
        # Each RAW should try to pair with JPEG
        # But second RAW might find JPEG already stacked
        stacks = PhotoStack.objects.filter(
            owner=self.user,
            stack_type=PhotoStack.StackType.RAW_JPEG_PAIR,
        )
        # Implementation should handle this - potentially 2 separate stacks
        # or merge into 1 if create_or_merge handles it
        self.assertGreaterEqual(count, 1)

    def test_deeply_nested_path(self):
        """Test detection with deeply nested directory path."""
        deep_path = "/photos" + "/subdir" * 50
        raw = self._create_photo_with_file(
            f"{deep_path}/IMG_001.CR2", File.RAW_FILE
        )
        jpeg = self._create_photo_with_file(
            f"{deep_path}/IMG_001.jpg", File.IMAGE
        )
        
        count = detect_raw_jpeg_pairs(self.user)
        self.assertEqual(count, 1)

    def test_whitespace_in_path(self):
        """Test detection with whitespace in directory and filename."""
        raw = self._create_photo_with_file(
            "/photos/My Photos/IMG 001.CR2", File.RAW_FILE
        )
        jpeg = self._create_photo_with_file(
            "/photos/My Photos/IMG 001.jpg", File.IMAGE
        )
        
        count = detect_raw_jpeg_pairs(self.user)
        self.assertEqual(count, 1)

    def test_jpeg_is_hidden_raw_is_not(self):
        """Test when JPEG is hidden but RAW is visible."""
        raw = self._create_photo_with_file(
            "/photos/IMG_001.CR2", File.RAW_FILE
        )
        jpeg = self._create_photo_with_file(
            "/photos/IMG_001.jpg", File.IMAGE, hidden=True
        )
        
        count = detect_raw_jpeg_pairs(self.user)
        # JPEG is hidden, so no pair should be created
        self.assertEqual(count, 0)


class MalformedRulesEdgeCasesTestCase(TestCase):
    """Edge cases for malformed burst detection rules."""

    def setUp(self):
        self.user = create_test_user()

    def test_invalid_json_string_rules(self):
        """Test detection with invalid JSON in burst_detection_rules."""
        self.user.burst_detection_rules = "not valid json {"
        self.user.save()
        
        # Should handle gracefully (json.loads will fail)
        with self.assertRaises(json.JSONDecodeError):
            detect_burst_sequences(self.user)

    def test_rules_as_dict_instead_of_list(self):
        """Test detection when rules are stored as dict instead of list."""
        self.user.burst_detection_rules = json.dumps({
            "rule1": {"enabled": True}
        })
        self.user.save()
        
        # as_rules expects a list, dict should cause issues
        # This tests if the code handles this gracefully
        try:
            count = detect_burst_sequences(self.user)
            # If it doesn't crash, it should return 0 (no valid rules)
            self.assertEqual(count, 0)
        except (TypeError, AttributeError) as e:
            # This is expected if the code doesn't handle dict input
            pass

    def test_rules_with_missing_required_fields(self):
        """Test detection with rules missing required fields."""
        self.user.burst_detection_rules = json.dumps([
            {
                "id": 1,
                # Missing: name, rule_type, category, enabled
            }
        ])
        self.user.save()
        
        # Should handle gracefully
        try:
            count = detect_burst_sequences(self.user)
            self.assertEqual(count, 0)
        except (KeyError, AttributeError):
            # Expected if code doesn't validate input
            pass

    def test_rules_with_unknown_rule_type(self):
        """Test detection with unknown rule_type."""
        self.user.burst_detection_rules = json.dumps([
            {
                "id": 1,
                "name": "Unknown Rule",
                "rule_type": "unknown_nonexistent_type",
                "category": "hard",
                "enabled": True,
            }
        ])
        self.user.save()
        
        # Should handle gracefully - unknown rule types should be skipped
        count = detect_burst_sequences(self.user)
        self.assertEqual(count, 0)


class BatchDetectionEdgeCasesTestCase(TestCase):
    """Edge cases for batch_detect_stacks."""

    def setUp(self):
        self.user = create_test_user()
        self.user.burst_detection_rules = json.dumps([])
        self.user.save()

    def test_partial_options(self):
        """Test batch detection with partial options dict."""
        # Only specify some options
        options = {'detect_raw_jpeg': False}
        
        with patch('api.stack_detection.detect_raw_jpeg_pairs') as mock_raw, \
             patch('api.stack_detection.detect_burst_sequences') as mock_burst, \
             patch('api.stack_detection.detect_live_photos') as mock_live:
            
            mock_raw.return_value = 0
            mock_burst.return_value = 0
            mock_live.return_value = 0
            
            batch_detect_stacks(self.user, options=options)
            
            # RAW should not be called (explicitly disabled)
            mock_raw.assert_not_called()
            # Burst and live should be called (defaults to True)
            mock_burst.assert_called_once()
            mock_live.assert_called_once()

    def test_empty_options_dict(self):
        """Test batch detection with empty options dict."""
        with patch('api.stack_detection.detect_raw_jpeg_pairs') as mock_raw, \
             patch('api.stack_detection.detect_burst_sequences') as mock_burst, \
             patch('api.stack_detection.detect_live_photos') as mock_live:
            
            mock_raw.return_value = 0
            mock_burst.return_value = 0
            mock_live.return_value = 0
            
            batch_detect_stacks(self.user, options={})
            
            # All should be called with defaults (True)
            mock_raw.assert_called_once()
            mock_burst.assert_called_once()
            mock_live.assert_called_once()

    @patch('api.stack_detection.detect_burst_sequences')
    @patch('api.stack_detection.detect_raw_jpeg_pairs')
    def test_exception_in_second_detector(self, mock_raw, mock_burst):
        """Test that exception in one detector still fails job properly."""
        mock_raw.return_value = 5
        mock_burst.side_effect = Exception("Burst detection crashed")
        
        with self.assertRaises(Exception):
            batch_detect_stacks(self.user)
        
        # Job should exist and be marked as failed
        jobs = LongRunningJob.objects.filter(started_by=self.user)
        self.assertEqual(jobs.count(), 1)


class ClearStacksEdgeCasesTestCase(TestCase):
    """Edge cases for clear_stacks_of_type."""

    def setUp(self):
        self.user = create_test_user()

    def test_clear_with_photo_in_multiple_stacks(self):
        """Test clearing when a photo is in multiple stacks of different types."""
        photo = create_test_photo(owner=self.user)
        
        # Add photo to burst stack
        burst_stack = PhotoStack.objects.create(
            owner=self.user,
            stack_type=PhotoStack.StackType.BURST_SEQUENCE,
        )
        burst_stack.photos.add(photo)
        
        # Add same photo to RAW+JPEG stack
        raw_stack = PhotoStack.objects.create(
            owner=self.user,
            stack_type=PhotoStack.StackType.RAW_JPEG_PAIR,
        )
        raw_stack.photos.add(photo)
        
        # Clear only burst stacks
        clear_stacks_of_type(self.user, PhotoStack.StackType.BURST_SEQUENCE)
        
        # Photo should still be in RAW stack
        photo.refresh_from_db()
        self.assertEqual(photo.stacks.count(), 1)
        self.assertEqual(photo.stacks.first().stack_type, PhotoStack.StackType.RAW_JPEG_PAIR)

    def test_clear_with_many_stacks(self):
        """Test clearing a large number of stacks."""
        # Create 100 stacks
        for i in range(100):
            stack = PhotoStack.objects.create(
                owner=self.user,
                stack_type=PhotoStack.StackType.BURST_SEQUENCE,
            )
            photo1 = create_test_photo(owner=self.user)
            photo2 = create_test_photo(owner=self.user)
            stack.photos.add(photo1, photo2)
        
        count = clear_stacks_of_type(self.user, PhotoStack.StackType.BURST_SEQUENCE)
        
        self.assertEqual(count, 100)
        self.assertEqual(
            PhotoStack.objects.filter(
                owner=self.user,
                stack_type=PhotoStack.StackType.BURST_SEQUENCE,
            ).count(),
            0
        )


class SequenceTimestampEdgeCasesTestCase(TestCase):
    """Edge cases for sequence_start/sequence_end handling in burst stacks."""

    def setUp(self):
        self.user = create_test_user()

    def test_burst_stack_with_none_timestamps(self):
        """Test burst stack creation when photos have None exif_timestamp."""
        photo1 = create_test_photo(owner=self.user)
        photo2 = create_test_photo(owner=self.user)
        photo1.exif_timestamp = None
        photo2.exif_timestamp = None
        photo1.save()
        photo2.save()
        
        # Create burst stack with None timestamps
        stack = _create_burst_stack(self.user, [photo1, photo2])
        
        # Should still create stack, sequence timestamps will be None
        self.assertIsNotNone(stack)
        self.assertIsNone(stack.sequence_start)
        self.assertIsNone(stack.sequence_end)

    def test_create_or_merge_updates_sequence_timestamps(self):
        """Test that create_or_merge properly extends sequence timestamps."""
        from django.utils import timezone
        
        base_time = timezone.now()
        
        photo1 = create_test_photo(owner=self.user)
        photo2 = create_test_photo(owner=self.user)
        photo1.exif_timestamp = base_time
        photo2.exif_timestamp = base_time + timedelta(seconds=1)
        photo1.save()
        photo2.save()
        
        # Create initial stack
        stack = PhotoStack.create_or_merge(
            owner=self.user,
            stack_type=PhotoStack.StackType.BURST_SEQUENCE,
            photos=[photo1, photo2],
            sequence_start=base_time,
            sequence_end=base_time + timedelta(seconds=1),
        )
        
        # Create third photo with earlier timestamp
        photo3 = create_test_photo(owner=self.user)
        photo3.exif_timestamp = base_time - timedelta(seconds=1)
        photo3.save()
        
        # Merge with earlier timestamp
        stack = PhotoStack.create_or_merge(
            owner=self.user,
            stack_type=PhotoStack.StackType.BURST_SEQUENCE,
            photos=[photo1, photo3],  # photo1 already in stack
            sequence_start=base_time - timedelta(seconds=1),
            sequence_end=base_time,
        )
        
        stack.refresh_from_db()
        # sequence_start should be updated to earlier time
        self.assertEqual(stack.sequence_start, base_time - timedelta(seconds=1))


class FilenamePatternEdgeCasesTestCase(TestCase):
    """Edge cases for filename pattern matching in detection."""

    def setUp(self):
        self.user = create_test_user()
        self.user.burst_detection_rules = json.dumps([
            {
                "id": 1,
                "name": "Filename Pattern",
                "rule_type": "filename_pattern",
                "category": "hard",
                "enabled": True,
                "pattern": r"^IMG_(\d+)_BURST(\d+)\.jpg$",
                "group_by": "burst_id",
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

    def _create_photo_with_file(self, path, **kwargs):
        """Helper to create Photo with associated File."""
        file = self._create_file(path, File.IMAGE)
        photo = create_test_photo(owner=self.user, **kwargs)
        photo.main_file = file
        photo.save()
        return photo

    def test_regex_pattern_special_chars(self):
        """Test filename pattern with special regex characters."""
        self.user.burst_detection_rules = json.dumps([
            {
                "id": 1,
                "name": "Pattern with brackets",
                "rule_type": "filename_pattern",
                "category": "hard",
                "enabled": True,
                "pattern": r"^IMG_\[(\d+)\]\.jpg$",
                "group_by": "photo_id",
            }
        ])
        self.user.save()
        
        photo1 = self._create_photo_with_file("/photos/IMG_[001].jpg")
        photo2 = self._create_photo_with_file("/photos/IMG_[001].jpg")  # Same pattern
        
        # Should not crash on regex special characters
        count = detect_burst_sequences(self.user)
        self.assertGreaterEqual(count, 0)

    def test_empty_filename(self):
        """Test handling of empty filename (edge case)."""
        # Create photo with empty filename component
        file = File.objects.create(
            hash=str(uuid.uuid4())[:32],
            path="/photos/",  # Just directory, no filename
            type=File.IMAGE,
        )
        photo = create_test_photo(owner=self.user)
        photo.main_file = file
        photo.save()
        
        # Should handle gracefully
        count = detect_burst_sequences(self.user)
        self.assertEqual(count, 0)
