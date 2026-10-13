"""Tests for extractor module."""

from unittest.mock import MagicMock, patch

from django.test import TestCase

from api.faces import extractor


class FaceExtractorTest(TestCase):
    """Test face extraction functionality."""

    @patch("api.faces.extractor.detect_faces")
    def test_extract_from_face_service_propagates_errors(self, mock_detect_faces):
        """A face-service error is not "no faces" (#2199): the scan records and retries it."""
        mock_detect_faces.side_effect = ConnectionError("Connection refused")

        with self.assertRaises(ConnectionError):
            extractor.extract_from_face_service(
                big_thumbnail_path="/path/to/thumbnail.jpg"
            )

    @patch("api.faces.extractor.detect_faces")
    def test_extract_from_face_service_success(self, mock_detect_faces):
        """Test that extract_from_face_service works correctly on success."""
        # Setup: make detect_faces return some faces, one without an encoding
        mock_detect_faces.return_value = [
            ((10, 20, 30, 40), "encoding-1"),
            ((50, 60, 70, 80), None),
        ]

        # Call the function
        result = extractor.extract_from_face_service(
            big_thumbnail_path="/path/to/thumbnail.jpg",
        )

        # Locations, no person name, and the encoding the service computed
        expected = [
            (10, 20, 30, 40, None, "encoding-1"),
            (50, 60, 70, 80, None, None),
        ]
        self.assertEqual(result, expected)
        mock_detect_faces.assert_called_once_with("/path/to/thumbnail.jpg")

    @patch("api.faces.extractor.extract_from_exif")
    @patch("api.faces.extractor.extract_from_face_service")
    def test_extract_prefers_exif(self, mock_face_service, mock_exif):
        """Test that extract function prefers EXIF data over face service."""
        # Setup: make extract_from_exif return some data
        mock_exif_data = [(10, 20, 30, 40, "John Doe")]
        mock_exif.return_value = mock_exif_data

        mock_owner = MagicMock()

        # Call the function
        result = extractor.extract(
            image_path="/path/to/image.jpg",
            big_thumbnail_path="/path/to/thumbnail.jpg",
            owner=mock_owner,
        )

        # Verify that it returns EXIF data and doesn't call face service
        self.assertEqual(result, mock_exif_data)
        mock_face_service.assert_not_called()

    @patch("api.faces.extractor.extract_from_exif")
    @patch("api.faces.extractor.extract_from_face_service")
    def test_extract_fallback_to_face_service(self, mock_face_service, mock_exif):
        """Test that extract function falls back to face service when no EXIF data."""
        # Setup: make extract_from_exif return None
        mock_exif.return_value = None
        mock_face_service_data = [(10, 20, 30, 40, None)]
        mock_face_service.return_value = mock_face_service_data

        mock_owner = MagicMock()

        # Call the function
        result = extractor.extract(
            image_path="/path/to/image.jpg",
            big_thumbnail_path="/path/to/thumbnail.jpg",
            owner=mock_owner,
        )

        # Verify that it returns face service data
        self.assertEqual(result, mock_face_service_data)
        mock_face_service.assert_called_once()
