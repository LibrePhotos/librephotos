"""Tests for extractor module."""

from unittest.mock import patch

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
