"""Tests for face_extractor module."""

from unittest.mock import MagicMock, patch

from django.test import TestCase

from api import face_extractor


class FaceExtractorTest(TestCase):
    """Test face extraction functionality."""

    @patch("api.face_extractor.get_face_locations")
    def test_extract_from_dlib_handles_exception(self, mock_get_face_locations):
        """Test that extract_from_dlib returns empty list when exception occurs."""
        # Setup: make get_face_locations raise an exception
        mock_get_face_locations.side_effect = Exception("Test exception")

        # Create a mock owner with face_recognition_model
        mock_owner = MagicMock()
        mock_owner.face_recognition_model = "hog"

        # Call the function
        result = face_extractor.extract_from_dlib(
            image_path="/path/to/image.jpg",
            big_thumbnail_path="/path/to/thumbnail.jpg",
            owner=mock_owner,
        )

        # Verify that it returns an empty list instead of raising UnboundLocalError
        self.assertEqual(result, [])

    @patch("api.face_extractor.get_face_locations")
    def test_extract_from_dlib_success(self, mock_get_face_locations):
        """Test that extract_from_dlib works correctly on success."""
        # Setup: make get_face_locations return some face locations
        mock_face_locations = [(10, 20, 30, 40), (50, 60, 70, 80)]
        mock_get_face_locations.return_value = mock_face_locations

        # Create a mock owner with face_recognition_model
        mock_owner = MagicMock()
        mock_owner.face_recognition_model = "hog"

        # Call the function
        result = face_extractor.extract_from_dlib(
            image_path="/path/to/image.jpg",
            big_thumbnail_path="/path/to/thumbnail.jpg",
            owner=mock_owner,
        )

        # Verify that it returns face locations with None appended
        expected = [(10, 20, 30, 40, None), (50, 60, 70, 80, None)]
        self.assertEqual(result, expected)

    @patch("api.face_extractor.extract_from_exif")
    @patch("api.face_extractor.extract_from_dlib")
    def test_extract_prefers_exif(self, mock_dlib, mock_exif):
        """Test that extract function prefers EXIF data over dlib."""
        # Setup: make extract_from_exif return some data
        mock_exif_data = [(10, 20, 30, 40, "John Doe")]
        mock_exif.return_value = mock_exif_data

        mock_owner = MagicMock()

        # Call the function
        result = face_extractor.extract(
            image_path="/path/to/image.jpg",
            big_thumbnail_path="/path/to/thumbnail.jpg",
            owner=mock_owner,
        )

        # Verify that it returns EXIF data and doesn't call dlib
        self.assertEqual(result, mock_exif_data)
        mock_dlib.assert_not_called()

    @patch("api.face_extractor.extract_from_exif")
    @patch("api.face_extractor.extract_from_dlib")
    def test_extract_fallback_to_dlib(self, mock_dlib, mock_exif):
        """Test that extract function falls back to dlib when no EXIF data."""
        # Setup: make extract_from_exif return None
        mock_exif.return_value = None
        mock_dlib_data = [(10, 20, 30, 40, None)]
        mock_dlib.return_value = mock_dlib_data

        mock_owner = MagicMock()

        # Call the function
        result = face_extractor.extract(
            image_path="/path/to/image.jpg",
            big_thumbnail_path="/path/to/thumbnail.jpg",
            owner=mock_owner,
        )

        # Verify that it returns dlib data
        self.assertEqual(result, mock_dlib_data)
        mock_dlib.assert_called_once()
