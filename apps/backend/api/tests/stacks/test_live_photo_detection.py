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
from unittest.mock import MagicMock, Mock, patch

from django.test import TestCase, override_settings

from api.mime import LIVE_PHOTO_VIDEO_EXTENSIONS
from api.stacks.live_photo import (
    GOOGLE_PIXEL_MP4_SIGNATURES,
    JPEG_EOI_MARKER,
    SAMSUNG_MOTION_MARKER,
    _locate_google_embedded_video,
    _locate_samsung_embedded_video,
    extract_embedded_motion_video,
    has_embedded_motion_video,
)


class LocateGoogleEmbeddedVideoTestCase(TestCase):
    """Tests for the _locate_google_embedded_video function."""

    def test_finds_ftypmp42_signature(self):
        """Should find MP4 with ftypmp42 signature."""
        # Build data: JPEG content + 4 padding bytes + ftyp signature
        data = (
            b"JPEG_CONTENT\xff\xd9"
            + b"\x00\x00\x00\x00"
            + b"ftypmp42"
            + b"more_video_data"
        )
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

    @patch("api.stacks.live_photo.mime_type", return_value="image/png")
    def test_returns_false_for_non_jpeg(self, _mime_type):
        """Should return False for non-JPEG files."""
        result = has_embedded_motion_video("/some/path.png")
        self.assertFalse(result)

    @patch("api.stacks.live_photo.mime_type", return_value="image/jpeg")
    @patch("builtins.open")
    @patch("api.stacks.live_photo.mmap")
    def test_returns_true_for_google_motion_photo(
        self, mock_mmap, mock_open, _mime_type
    ):
        """Should return True for Google Motion Photo."""
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

        with patch(
            "api.stacks.live_photo._locate_google_embedded_video", return_value=4
        ):
            result = has_embedded_motion_video("/some/path.jpg")
            self.assertTrue(result)

    @patch("api.stacks.live_photo.mime_type", side_effect=Exception("File not found"))
    def test_returns_false_on_exception(self, _mime_type):
        """Should return False and log warning on exception."""

        with patch("api.stacks.live_photo.logger") as mock_logger:
            result = has_embedded_motion_video("/nonexistent/path.jpg")
            self.assertFalse(result)
            mock_logger.warning.assert_called()


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
                b"JPEG_IMAGE_DATA\xff\xd9"  # JPEG with EOI marker
                + b"\x00\x00\x00\x00"  # 4 padding bytes
                + b"ftypmp42"  # ftyp signature
                + fake_video_data
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
        """Apple Live Photo videos are .mov files (any case is tried on disk)."""
        self.assertIn(".mov", LIVE_PHOTO_VIDEO_EXTENSIONS)


class EdgeCasesTestCase(TestCase):
    """Edge case tests for live photo detection."""

    def setUp(self):
        """Create temporary directory."""
        self.temp_dir = tempfile.mkdtemp()

    def tearDown(self):
        """Clean up."""
        import shutil

        shutil.rmtree(self.temp_dir, ignore_errors=True)

    def test_locate_video_at_start_of_data(self):
        """Should handle video marker at very start of data."""
        data = b"ftypmp42rest_of_video"
        position = _locate_google_embedded_video(data)
        self.assertEqual(position, -4)  # Would be negative, which is fine

    def test_multiple_samsung_markers(self):
        """Should find first Samsung marker if multiple present."""
        data = (
            SAMSUNG_MOTION_MARKER
            + b"first_video"
            + SAMSUNG_MOTION_MARKER
            + b"second_video"
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
