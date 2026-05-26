"""Regression tests for ``api.metadata.reader.get_metadata``.

The exif service (``service/exif/main.py``) can return a ``values`` list
shorter than the requested ``tags`` list — for example, when exiftool raises
mid-loop, the partial list is returned with HTTP 201.  Several callers
unpack the result positionally (``a, b = get_metadata(...)``) and crash with
``ValueError: not enough values to unpack`` when that happens.

These tests exercise the padding contract documented in the function's
docstring: one value per tag, ``None`` when the tag was not found.
"""

from unittest.mock import MagicMock, patch

from django.test import SimpleTestCase

from api.metadata.reader import get_metadata


class GetMetadataPaddingTest(SimpleTestCase):
    def _mock_response(self, values):
        response = MagicMock()
        response.json.return_value = {"values": values}
        return response

    @patch("api.metadata.reader.requests.post")
    def test_returns_values_when_service_returns_expected_count(self, mock_post):
        mock_post.return_value = self._mock_response([12.34, 56.78])

        result = get_metadata("/tmp/photo.jpg", tags=["GPS:Latitude", "GPS:Longitude"])

        self.assertEqual(result, [12.34, 56.78])

    @patch("api.metadata.reader.requests.post")
    def test_pads_with_none_when_service_returns_empty_list(self, mock_post):
        # Reproduces the crash seen in production: exiftool errored on the
        # first tag, so the service returned an empty list and the caller
        # crashed unpacking two values.
        mock_post.return_value = self._mock_response([])

        result = get_metadata("/tmp/photo.jpg", tags=["GPS:Latitude", "GPS:Longitude"])

        self.assertEqual(result, [None, None])

    @patch("api.metadata.reader.requests.post")
    def test_pads_with_none_when_service_returns_partial_list(self, mock_post):
        mock_post.return_value = self._mock_response([12.34])

        result = get_metadata(
            "/tmp/photo.jpg",
            tags=["GPS:Latitude", "GPS:Longitude", "EXIF:Orientation"],
        )

        self.assertEqual(result, [12.34, None, None])
