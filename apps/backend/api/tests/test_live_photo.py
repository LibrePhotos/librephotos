"""
Comprehensive tests for api/stacks/live_photo.py

Tests the Live Photo detection and stacking logic:
- Google Pixel Motion Photo detection (embedded MP4 after JPEG EOI)
- Samsung Motion Photo detection (MotionPhoto_Data marker)
- Apple Live Photo detection (paired .mov file)
- Stack creation for detected live photos
- Batch processing
"""

import os
import tempfile
from pathlib import Path
from unittest.mock import MagicMock, Mock, patch

from django.test import TestCase, override_settings

from api.models.file import File
from api.models.photo import Photo
from api.models.photo_stack import PhotoStack
from api.models.user import User
from api.stacks.live_photo import (
    APPLE_LIVE_PHOTO_EXTENSIONS,
    GOOGLE_PIXEL_MP4_SIGNATURES,
    JPEG_EOI_MARKER,
    SAMSUNG_MOTION_MARKER,
    _create_apple_live_photo_stack,
    _create_embedded_live_photo_stack,
    _locate_google_embedded_video,
    _locate_samsung_embedded_video,
    detect_live_photo,
    extract_embedded_motion_video,
    find_apple_live_photo_video,
    has_embedded_motion_video,
    process_live_photos_batch,
)


class LocateGoogleEmbeddedVideoTestCase(TestCase):
    """Tests for the _locate_google_embedded_video function."""

    def test_finds_ftypmp42_signature(self):
        """Should find MP4 with ftypmp42 signature."""
        # Build data: JPEG content + 4 padding bytes + ftyp signature
        data = b"JPEG_CONTENT\xff\xd9" + b"\x00\x00\x00\x00" + b"ftypmp42" + b"more_video_data"
        position = _locate_google_embedded_video(data)
        expected = data.find(b"ftypmp42") - 4
        self.assertEqual(position, expected)

    def test_finds_ftypisom_signature(self):
        """Should find MP4 with ftypisom signature."""
        data = b"JPEG_CONTENT\xff\xd9" + b"\x00\x00\x00\x20" + b"ftypisom"
        position = _locate_google_embedded_video(data)
        expected = data.find(b"ftypisom") - 4
        self.assertEqual(position, expected)

    def test_finds_ftypiso2_signature(self):
        """Should find MP4 with ftypiso2 signature."""
        data = b"JPEG_CONTENT\xff\xd9" + b"\x00\x00\x00\x20" + b"ftypiso2"
        position = _locate_google_embedded_video(data)
        expected = data.find(b"ftypiso2") - 4
        self.assertEqual(position, expected)

    def test_returns_minus_one_when_not_found(self):
        """Should return -1 if no signature found."""
        data = b"JPEG_CONTENT\xff\xd9_no_video_here"
        position = _locate_google_embedded_video(data)
        self.assertEqual(position, -1)

    def test_empty_data(self):
        """Should return -1 for empty data."""
        position = _locate_google_embedded_video(b"")
        self.assertEqual(position, -1)

    def test_finds_first_signature_if_multiple(self):
        """Should find the first signature if multiple exist."""
        data = b"JPEG" + b"\x00\x00\x00\x00" + b"ftypmp42" + b"MIDDLE" + b"ftypisom"
        position = _locate_google_embedded_video(data)
        # Should find ftypmp42 first
        self.assertEqual(position, 4)  # 4 bytes for "JPEG"


class LocateSamsungEmbeddedVideoTestCase(TestCase):
    """Tests for the _locate_samsung_embedded_video function."""

    def test_finds_samsung_marker(self):
        """Should find Samsung motion photo marker."""
        data = b"JPEG_CONTENT\xff\xd9" + SAMSUNG_MOTION_MARKER + b"video_data"
        position = _locate_samsung_embedded_video(data)
        expected = data.find(SAMSUNG_MOTION_MARKER) + len(SAMSUNG_MOTION_MARKER)
        self.assertEqual(position, expected)

    def test_returns_minus_one_when_not_found(self):
        """Should return -1 if no marker found."""
        data = b"JPEG_CONTENT\xff\xd9_no_motion_marker"
        position = _locate_samsung_embedded_video(data)
        self.assertEqual(position, -1)

    def test_empty_data(self):
        """Should return -1 for empty data."""
        position = _locate_samsung_embedded_video(b"")
        self.assertEqual(position, -1)


class HasEmbeddedMotionVideoTestCase(TestCase):
    """Tests for the has_embedded_motion_video function."""

    def setUp(self):
        """Create temporary directory for test files."""
        self.temp_dir = tempfile.mkdtemp()

    def tearDown(self):
        """Clean up temporary files."""
        import shutil
        shutil.rmtree(self.temp_dir, ignore_errors=True)

    @patch("api.stacks.live_photo.magic.Magic")
    def test_returns_false_for_non_jpeg(self, mock_magic_class):
        """Should return False for non-JPEG files."""
        mock_magic = MagicMock()
        mock_magic.from_file.return_value = "image/png"
        mock_magic_class.return_value = mock_magic

        result = has_embedded_motion_video("/some/path.png")
        self.assertFalse(result)

    @patch("api.stacks.live_photo.magic.Magic")
    @patch("builtins.open")
    @patch("api.stacks.live_photo.mmap")
    def test_returns_true_for_google_motion_photo(self, mock_mmap, mock_open, mock_magic_class):
        """Should return True for Google Motion Photo."""
        mock_magic = MagicMock()
        mock_magic.from_file.return_value = "image/jpeg"
        mock_magic_class.return_value = mock_magic

        # Mock file data with Google MP4 signature
        mock_data = b"JPEG" + b"\x00\x00\x00\x00" + b"ftypmp42"
        mock_mm = MagicMock()
        mock_mm.__enter__ = Mock(return_value=mock_data)
        mock_mm.__exit__ = Mock(return_value=False)
        mock_mmap.return_value = mock_mm

        mock_file = MagicMock()
        mock_file.__enter__ = Mock(return_value=mock_file)
        mock_file.__exit__ = Mock(return_value=False)
        mock_open.return_value = mock_file

        with patch("api.stacks.live_photo._locate_google_embedded_video", return_value=4):
            result = has_embedded_motion_video("/some/path.jpg")
            self.assertTrue(result)

    @patch("api.stacks.live_photo.magic.Magic")
    def test_returns_false_on_exception(self, mock_magic_class):
        """Should return False and log warning on exception."""
        mock_magic_class.side_effect = Exception("File not found")

        with patch("api.stacks.live_photo.logger") as mock_logger:
            result = has_embedded_motion_video("/nonexistent/path.jpg")
            self.assertFalse(result)
            mock_logger.warning.assert_called()


class FindAppleLivePhotoVideoTestCase(TestCase):
    """Tests for the find_apple_live_photo_video function."""

    def setUp(self):
        """Create temporary directory for test files."""
        self.temp_dir = tempfile.mkdtemp()

    def tearDown(self):
        """Clean up temporary files."""
        import shutil
        shutil.rmtree(self.temp_dir, ignore_errors=True)

    def test_finds_lowercase_mov_companion(self):
        """Should find .mov companion file."""
        # Create test files
        image_path = os.path.join(self.temp_dir, "IMG_001.jpg")
        video_path = os.path.join(self.temp_dir, "IMG_001.mov")
        Path(image_path).touch()
        Path(video_path).touch()

        result = find_apple_live_photo_video(image_path)
        self.assertEqual(result, video_path)

    def test_finds_uppercase_mov_companion(self):
        """Should find .MOV companion file (uppercase)."""
        image_path = os.path.join(self.temp_dir, "IMG_002.HEIC")
        video_path = os.path.join(self.temp_dir, "IMG_002.MOV")
        Path(image_path).touch()
        Path(video_path).touch()

        result = find_apple_live_photo_video(image_path)
        self.assertEqual(result, video_path)

    def test_returns_none_when_no_companion(self):
        """Should return None if no companion video exists."""
        image_path = os.path.join(self.temp_dir, "IMG_003.jpg")
        Path(image_path).touch()

        result = find_apple_live_photo_video(image_path)
        self.assertIsNone(result)

    def test_prefers_lowercase_mov(self):
        """Should prefer .mov over .MOV if both exist."""
        image_path = os.path.join(self.temp_dir, "IMG_004.jpg")
        video_lowercase = os.path.join(self.temp_dir, "IMG_004.mov")
        video_uppercase = os.path.join(self.temp_dir, "IMG_004.MOV")
        Path(image_path).touch()
        Path(video_lowercase).touch()
        Path(video_uppercase).touch()

        result = find_apple_live_photo_video(image_path)
        # Should find .mov first (lowercase is first in APPLE_LIVE_PHOTO_EXTENSIONS)
        self.assertEqual(result, video_lowercase)

    def test_handles_different_image_extensions(self):
        """Should work with various image extensions."""
        for ext in [".jpg", ".JPG", ".heic", ".HEIC", ".jpeg"]:
            image_path = os.path.join(self.temp_dir, f"test{ext}")
            video_path = os.path.join(self.temp_dir, "test.mov")
            Path(image_path).touch()
            Path(video_path).touch()

            result = find_apple_live_photo_video(image_path)
            self.assertEqual(result, video_path)

            # Cleanup for next iteration
            Path(image_path).unlink()
            Path(video_path).unlink()


class ExtractEmbeddedMotionVideoTestCase(TestCase):
    """Tests for the extract_embedded_motion_video function."""

    def setUp(self):
        """Create temporary directory for test files."""
        self.temp_dir = tempfile.mkdtemp()

    def tearDown(self):
        """Clean up temporary files."""
        import shutil
        shutil.rmtree(self.temp_dir, ignore_errors=True)

    @override_settings(MEDIA_ROOT=None)
    def test_extracts_google_motion_video(self):
        """Should extract embedded MP4 from Google Motion Photo."""
        # Use temp_dir as MEDIA_ROOT
        with self.settings(MEDIA_ROOT=self.temp_dir):
            # Create a fake motion photo file
            fake_video_data = b"fake_mp4_video_content"
            file_content = (
                b"JPEG_IMAGE_DATA\xff\xd9" +  # JPEG with EOI marker
                b"\x00\x00\x00\x00" +  # 4 padding bytes
                b"ftypmp42" +  # ftyp signature
                fake_video_data
            )

            input_path = os.path.join(self.temp_dir, "motion_photo.jpg")
            with open(input_path, "wb") as f:
                f.write(file_content)

            result = extract_embedded_motion_video(input_path, "test_hash_123")

            self.assertIsNotNone(result)
            self.assertIn("test_hash_123_motion.mp4", result)
            self.assertTrue(os.path.exists(result))

            # Verify extracted content starts from ftyp
            with open(result, "rb") as f:
                extracted = f.read()
                self.assertTrue(extracted.startswith(b"\x00\x00\x00\x00ftypmp42"))

    def test_returns_none_for_no_embedded_video(self):
        """Should return None if no embedded video found."""
        with self.settings(MEDIA_ROOT=self.temp_dir):
            # Create a regular JPEG without embedded video
            input_path = os.path.join(self.temp_dir, "regular.jpg")
            with open(input_path, "wb") as f:
                f.write(b"JPEG_DATA\xff\xd9")

            result = extract_embedded_motion_video(input_path, "hash123")
            self.assertIsNone(result)

    def test_returns_none_on_file_error(self):
        """Should return None and log error if file access fails."""
        with patch("api.stacks.live_photo.logger") as mock_logger:
            result = extract_embedded_motion_video("/nonexistent/file.jpg", "hash")
            self.assertIsNone(result)
            mock_logger.error.assert_called()


class DetectLivePhotoTestCase(TestCase):
    """Tests for the detect_live_photo function."""

    def setUp(self):
        """Create test user and temporary files."""
        self.temp_dir = tempfile.mkdtemp()
        self.user = User.objects.create(username="livetest")

    def tearDown(self):
        """Clean up."""
        import shutil
        shutil.rmtree(self.temp_dir, ignore_errors=True)

    def test_returns_none_for_photo_without_main_file(self):
        """Should return None if photo has no main_file."""
        photo = MagicMock()
        photo.main_file = None

        result = detect_live_photo(photo, self.user)
        self.assertIsNone(result)

    @patch("api.stacks.live_photo.has_embedded_motion_video")
    @patch("api.stacks.live_photo._create_embedded_live_photo_stack")
    def test_detects_embedded_motion_video(self, mock_create, mock_has_embedded):
        """Should detect and create stack for embedded motion video."""
        mock_has_embedded.return_value = True
        mock_stack = MagicMock()
        mock_create.return_value = mock_stack

        photo = MagicMock()
        photo.main_file.path = "/path/to/image.jpg"

        result = detect_live_photo(photo, self.user)

        mock_create.assert_called_once_with(photo, self.user)
        self.assertEqual(result, mock_stack)

    @patch("api.stacks.live_photo.has_embedded_motion_video")
    @patch("api.stacks.live_photo.find_apple_live_photo_video")
    @patch("api.stacks.live_photo._create_apple_live_photo_stack")
    def test_detects_apple_live_photo(self, mock_create, mock_find, mock_has_embedded):
        """Should detect and create stack for Apple Live Photo."""
        mock_has_embedded.return_value = False
        mock_find.return_value = "/path/to/video.mov"
        mock_stack = MagicMock()
        mock_create.return_value = mock_stack

        photo = MagicMock()
        photo.main_file.path = "/path/to/image.jpg"

        result = detect_live_photo(photo, self.user)

        mock_create.assert_called_once_with(photo, "/path/to/video.mov", self.user)
        self.assertEqual(result, mock_stack)

    @patch("api.stacks.live_photo.has_embedded_motion_video")
    @patch("api.stacks.live_photo.find_apple_live_photo_video")
    def test_returns_none_for_regular_photo(self, mock_find, mock_has_embedded):
        """Should return None for regular photos without motion."""
        mock_has_embedded.return_value = False
        mock_find.return_value = None

        photo = MagicMock()
        photo.main_file.path = "/path/to/regular.jpg"

        result = detect_live_photo(photo, self.user)
        self.assertIsNone(result)


class CreateEmbeddedLivePhotoStackTestCase(TestCase):
    """Tests for _create_embedded_live_photo_stack function."""

    def setUp(self):
        """Create test user."""
        self.user = User.objects.create(username="embedtest")
        self.temp_dir = tempfile.mkdtemp()

    def tearDown(self):
        """Clean up."""
        import shutil
        shutil.rmtree(self.temp_dir, ignore_errors=True)

    @override_settings(FEATURE_PROCESS_EMBEDDED_MEDIA=False)
    def test_returns_none_if_feature_disabled(self):
        """Should return None if embedded media processing is disabled."""
        photo = MagicMock()

        with patch("api.stacks.live_photo.logger") as mock_logger:
            result = _create_embedded_live_photo_stack(photo, self.user)
            self.assertIsNone(result)
            mock_logger.debug.assert_called()

    @override_settings(FEATURE_PROCESS_EMBEDDED_MEDIA=True)
    @patch("api.stacks.live_photo.extract_embedded_motion_video")
    def test_returns_none_if_extraction_fails(self, mock_extract):
        """Should return None if video extraction fails."""
        mock_extract.return_value = None

        photo = MagicMock()
        photo.main_file.path = "/path/to/image.jpg"
        photo.main_file.hash = "abc123"

        result = _create_embedded_live_photo_stack(photo, self.user)
        self.assertIsNone(result)

    @override_settings(FEATURE_PROCESS_EMBEDDED_MEDIA=True)
    @patch("api.stacks.live_photo.extract_embedded_motion_video")
    @patch("api.stacks.live_photo.File.create")
    def test_returns_existing_stack_if_present(self, mock_file_create, mock_extract):
        """Should return existing stack if photo already has one."""
        mock_extract.return_value = "/path/to/video.mp4"
        mock_video_file = MagicMock()
        mock_file_create.return_value = mock_video_file

        # Create a mock photo with existing stack
        existing_stack = MagicMock()
        photo = MagicMock()
        photo.main_file.path = "/path/to/image.jpg"
        photo.main_file.hash = "abc123"
        photo.main_file.embedded_media = MagicMock()
        photo.stacks.filter.return_value.first.return_value = existing_stack

        result = _create_embedded_live_photo_stack(photo, self.user)
        self.assertEqual(result, existing_stack)


class CreateAppleLivePhotoStackTestCase(TestCase):
    """Tests for _create_apple_live_photo_stack function."""

    def setUp(self):
        """Create test user and file."""
        from django.utils import timezone

        self.user = User.objects.create(username="appletest")
        self.temp_dir = tempfile.mkdtemp()

        # Create a test file
        self.file_hash = "a" * 32
        self.file_path = os.path.join(self.temp_dir, "test.jpg")
        Path(self.file_path).touch()

        self.file = File.objects.create(
            hash=self.file_hash,
            path=self.file_path,
            type=File.IMAGE,
        )

        # Create a test photo with required fields
        self.photo = Photo.objects.create(
            owner=self.user,
            main_file=self.file,
            image_hash="b" * 32,
            added_on=timezone.now(),
        )

    def tearDown(self):
        """Clean up."""
        import shutil
        shutil.rmtree(self.temp_dir, ignore_errors=True)

    def test_creates_new_stack_for_apple_live_photo(self):
        """Should create new Live Photo stack."""
        video_path = os.path.join(self.temp_dir, "test.mov")
        Path(video_path).touch()

        # Create a real video file to avoid foreign key issues
        video_file = File.objects.create(
            hash="c" * 32,
            path=video_path,
            type=File.VIDEO,
        )

        with patch("api.stacks.live_photo.File.create", return_value=video_file):
            with patch("api.stacks.live_photo.File.objects.filter") as mock_filter:
                # Simulate video file not existing yet
                mock_filter.return_value.first.return_value = None

                result = _create_apple_live_photo_stack(self.photo, video_path, self.user)

                self.assertIsNotNone(result)
                self.assertEqual(result.stack_type, PhotoStack.StackType.LIVE_PHOTO)
                self.assertEqual(result.primary_photo, self.photo)
                self.assertEqual(result.owner, self.user)

    def test_returns_existing_stack_if_present(self):
        """Should return existing stack if photo already has one."""
        # Create existing stack
        existing_stack = PhotoStack.objects.create(
            owner=self.user,
            stack_type=PhotoStack.StackType.LIVE_PHOTO,
            primary_photo=self.photo,
        )
        self.photo.stacks.add(existing_stack)

        video_path = os.path.join(self.temp_dir, "test.mov")
        Path(video_path).touch()

        # Create a real video file
        video_file = File.objects.create(
            hash="d" * 32,
            path=video_path,
            type=File.VIDEO,
        )

        with patch("api.stacks.live_photo.File.create", return_value=video_file):
            with patch("api.stacks.live_photo.File.objects.filter") as mock_filter:
                mock_filter.return_value.first.return_value = None

                result = _create_apple_live_photo_stack(self.photo, video_path, self.user)

                self.assertEqual(result, existing_stack)


class ProcessLivePhotosBatchTestCase(TestCase):
    """Tests for the process_live_photos_batch function."""

    def setUp(self):
        """Create test user."""
        self.user = User.objects.create(username="batchtest")

    @patch("api.stacks.live_photo.detect_live_photo")
    def test_processes_all_photos(self, mock_detect):
        """Should process all photos in the list."""
        mock_detect.return_value = None

        photos = [MagicMock() for _ in range(5)]
        result = process_live_photos_batch(self.user, photos)

        self.assertEqual(mock_detect.call_count, 5)
        self.assertEqual(result["detected"], 0)
        self.assertEqual(result["stacks_created"], 0)

    @patch("api.stacks.live_photo.detect_live_photo")
    def test_counts_detected_live_photos(self, mock_detect):
        """Should count detected live photos."""
        mock_stack = MagicMock()
        mock_stack.photo_count = 2  # Existing stack with photos
        mock_detect.side_effect = [mock_stack, None, mock_stack, None]

        photos = [MagicMock() for _ in range(4)]
        result = process_live_photos_batch(self.user, photos)

        self.assertEqual(result["detected"], 2)

    @patch("api.stacks.live_photo.detect_live_photo")
    def test_counts_new_stacks_created(self, mock_detect):
        """Should count newly created stacks."""
        new_stack = MagicMock()
        new_stack.photo_count = 1  # New stack (just the photo)
        mock_detect.return_value = new_stack

        photos = [MagicMock() for _ in range(3)]
        result = process_live_photos_batch(self.user, photos)

        self.assertEqual(result["detected"], 3)
        self.assertEqual(result["stacks_created"], 3)

    @patch("api.stacks.live_photo.detect_live_photo")
    def test_handles_exceptions_gracefully(self, mock_detect):
        """Should continue processing after exceptions."""
        mock_detect.side_effect = [Exception("Error"), MagicMock(photo_count=2)]

        photos = [MagicMock(), MagicMock()]
        photos[0].id = "photo1"
        photos[1].id = "photo2"

        with patch("api.stacks.live_photo.logger") as mock_logger:
            result = process_live_photos_batch(self.user, photos)
            mock_logger.error.assert_called()
            self.assertEqual(result["detected"], 1)

    def test_empty_list_returns_zero_counts(self):
        """Should return zero counts for empty list."""
        result = process_live_photos_batch(self.user, [])
        self.assertEqual(result["detected"], 0)
        self.assertEqual(result["stacks_created"], 0)


class ConstantsTestCase(TestCase):
    """Tests for module constants."""

    def test_jpeg_eoi_marker(self):
        """JPEG EOI marker should be correct."""
        self.assertEqual(JPEG_EOI_MARKER, b"\xff\xd9")

    def test_google_signatures_list(self):
        """Google MP4 signatures should be defined."""
        self.assertIn(b"ftypmp42", GOOGLE_PIXEL_MP4_SIGNATURES)
        self.assertIn(b"ftypisom", GOOGLE_PIXEL_MP4_SIGNATURES)
        self.assertIn(b"ftypiso2", GOOGLE_PIXEL_MP4_SIGNATURES)

    def test_samsung_marker(self):
        """Samsung motion marker should be correct."""
        self.assertEqual(SAMSUNG_MOTION_MARKER, b"MotionPhoto_Data")

    def test_apple_extensions(self):
        """Apple Live Photo extensions should include .mov variants."""
        self.assertIn(".mov", APPLE_LIVE_PHOTO_EXTENSIONS)
        self.assertIn(".MOV", APPLE_LIVE_PHOTO_EXTENSIONS)


class EdgeCasesTestCase(TestCase):
    """Edge case tests for live photo detection."""

    def setUp(self):
        """Create temporary directory."""
        self.temp_dir = tempfile.mkdtemp()

    def tearDown(self):
        """Clean up."""
        import shutil
        shutil.rmtree(self.temp_dir, ignore_errors=True)

    def test_unicode_filename_apple_live_photo(self):
        """Should handle unicode characters in filenames."""
        image_path = os.path.join(self.temp_dir, "照片_日本_🌸.jpg")
        video_path = os.path.join(self.temp_dir, "照片_日本_🌸.mov")
        Path(image_path).touch()
        Path(video_path).touch()

        result = find_apple_live_photo_video(image_path)
        self.assertEqual(result, video_path)

    def test_special_characters_in_path(self):
        """Should handle special characters in file path."""
        image_path = os.path.join(self.temp_dir, "test photo (1).jpg")
        video_path = os.path.join(self.temp_dir, "test photo (1).mov")
        Path(image_path).touch()
        Path(video_path).touch()

        result = find_apple_live_photo_video(image_path)
        self.assertEqual(result, video_path)

    def test_locate_video_at_start_of_data(self):
        """Should handle video marker at very start of data."""
        data = b"ftypmp42rest_of_video"
        position = _locate_google_embedded_video(data)
        self.assertEqual(position, -4)  # Would be negative, which is fine

    def test_multiple_samsung_markers(self):
        """Should find first Samsung marker if multiple present."""
        data = (
            SAMSUNG_MOTION_MARKER + b"first_video" +
            SAMSUNG_MOTION_MARKER + b"second_video"
        )
        position = _locate_samsung_embedded_video(data)
        self.assertEqual(position, len(SAMSUNG_MOTION_MARKER))

    def test_partial_signature_not_matched(self):
        """Should not match partial signatures."""
        # ftypm instead of ftypmp42
        data = b"JPEG\xff\xd9\x00\x00\x00\x00ftypm"
        position = _locate_google_embedded_video(data)
        self.assertEqual(position, -1)

    def test_very_large_file_simulation(self):
        """Should handle large data efficiently."""
        # Create 10MB of fake data with marker near end
        large_data = b"A" * (10 * 1024 * 1024)
        large_data += b"\x00\x00\x00\x00ftypmp42"

        position = _locate_google_embedded_video(large_data)
        self.assertGreater(position, 0)

    def test_binary_data_with_nulls(self):
        """Should handle binary data with null bytes."""
        data = b"\x00" * 100 + b"\x00\x00\x00\x00ftypmp42" + b"\x00" * 50
        position = _locate_google_embedded_video(data)
        self.assertEqual(position, 100)
