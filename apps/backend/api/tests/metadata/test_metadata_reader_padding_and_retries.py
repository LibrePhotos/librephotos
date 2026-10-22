"""Regression tests for ``api.metadata.reader.get_metadata``.

Several callers unpack the result positionally (``a, b = get_metadata(...)``)
and crash with ``ValueError: not enough values to unpack`` on a short list.

These tests exercise the contract documented in the function's docstring: one
value per tag, ``None`` when the tag was not found, and a raise (never a list
of ``None``) when the exif service could not read the file. Retrying a
refused connection or a 503 is the shared client's job (see
api/tests/infra/test_sidecar_client.py), so the HTTP layer is mocked below it.
"""

from unittest.mock import MagicMock, patch

import requests
from django.test import SimpleTestCase

from api.metadata.reader import MetadataReadError, get_metadata, origins_of

HTTP_POST = "api.runtime.sidecars.http.post"


def _values_response(values):
    response = MagicMock()
    response.raise_for_status.return_value = None
    response.json.return_value = {"values": values}
    return response


class GetMetadataPaddingTest(SimpleTestCase):
    @patch(HTTP_POST)
    def test_returns_values_when_service_returns_expected_count(self, mock_post):
        mock_post.return_value = _values_response([12.34, 56.78])

        result = get_metadata("/tmp/photo.jpg", tags=["GPS:Latitude", "GPS:Longitude"])

        self.assertEqual(result, [12.34, 56.78])

    @patch(HTTP_POST)
    def test_pads_with_none_when_service_returns_empty_list(self, mock_post):
        # Reproduces the crash seen in production: exiftool errored on the
        # first tag, so the service returned an empty list and the caller
        # crashed unpacking two values.
        mock_post.return_value = _values_response([])

        result = get_metadata("/tmp/photo.jpg", tags=["GPS:Latitude", "GPS:Longitude"])

        self.assertEqual(result, [None, None])

    @patch(HTTP_POST)
    def test_pads_with_none_when_service_returns_partial_list(self, mock_post):
        mock_post.return_value = _values_response([12.34])

        result = get_metadata(
            "/tmp/photo.jpg",
            tags=["GPS:Latitude", "GPS:Longitude", "EXIF:Orientation"],
        )

        self.assertEqual(result, [12.34, None, None])

    @patch(HTTP_POST)
    def test_asks_the_exif_sidecar(self, mock_post):
        mock_post.return_value = _values_response([None])

        get_metadata("/tmp/photo.jpg", tags=["EXIF:Make"], try_sidecar=False)

        self.assertEqual(mock_post.call_args.args[0], "http://127.0.0.1:8010/get-tags")
        self.assertEqual(
            mock_post.call_args.kwargs["json"],
            {
                "tags": ["EXIF:Make"],
                "files_by_reverse_priority": ["/tmp/photo.jpg"],
                "struct": False,
                "origins": True,
            },
        )


class GetMetadataOriginsTest(SimpleTestCase):
    """The answer says where each value came from (#2772)."""

    def _read(self, mock_post, answer, tags):
        response = _values_response(answer["values"])
        response.json.return_value = answer
        mock_post.return_value = response
        return get_metadata("/tmp/photo.jpg", tags=tags, sidecar_files=[])

    @patch(HTTP_POST)
    def test_the_values_carry_their_origins(self, mock_post):
        values = self._read(
            mock_post, {"values": ["a", None], "origins": [1, None]}, ["A", "B"]
        )

        self.assertEqual(["a", None], values)
        self.assertEqual([1, None], origins_of(values))

    @patch(HTTP_POST)
    def test_an_answer_without_usable_origins_has_none(self, mock_post):
        for answer in (
            {"values": ["a"]},
            {"values": ["a"], "origins": "1"},
            {"values": ["a"], "origins": [0, 1]},
        ):
            with self.subTest(answer=answer):
                self.assertEqual([], origins_of(self._read(mock_post, answer, ["A"])))

    @patch(HTTP_POST)
    def test_an_origin_that_is_not_a_number_is_none(self, mock_post):
        values = self._read(
            mock_post, {"values": [1, 2], "origins": [True, "0"]}, ["A", "B"]
        )
        self.assertEqual([None, None], origins_of(values))

    def test_a_plain_list_does_not_say(self):
        self.assertEqual([], origins_of([1, 2]))


class GetMetadataFailureTest(SimpleTestCase):
    """When the exif sidecar cannot answer, ``get_metadata`` raises instead of
    answering "no tags": a photo stored with empty metadata keeps no date or
    location, and a rescan never reads the unchanged file again. The scan
    records the raise as a per-file failure.
    """

    def _empty_body_response(self):
        # Mirrors requests' behaviour on an empty body: .json() raises.
        response = MagicMock()
        response.raise_for_status.return_value = None
        response.json.side_effect = requests.exceptions.JSONDecodeError(
            "Expecting value", "", 0
        )
        return response

    def _server_error_response(self, error):
        response = MagicMock()
        response.status_code = 500
        response.json.return_value = {"error": error}
        response.raise_for_status.side_effect = requests.HTTPError(
            "500 Server Error", response=response
        )
        return response

    @patch(HTTP_POST)
    def test_empty_body_raises(self, mock_post):
        mock_post.return_value = self._empty_body_response()

        with self.assertRaises(MetadataReadError):
            get_metadata("/tmp/photo.jpg", tags=["EXIF:Make", "EXIF:Model"])

    @patch(HTTP_POST)
    def test_a_reply_without_values_raises(self, mock_post):
        response = _values_response(None)
        response.json.return_value = {"status": "OK"}
        mock_post.return_value = response

        with self.assertRaises(MetadataReadError):
            get_metadata("/tmp/photo.jpg", tags=["EXIF:Make"])

    @patch(HTTP_POST)
    def test_connection_error_raises(self, mock_post):
        mock_post.side_effect = requests.exceptions.ConnectionError("closed")

        with self.assertRaises(MetadataReadError) as context:
            get_metadata("/tmp/photo.jpg", tags=["GPS:Latitude", "GPS:Longitude"])

        self.assertIn("closed", str(context.exception))

    @patch(HTTP_POST)
    def test_exiftool_error_raises_with_the_file_and_the_error(self, mock_post):
        mock_post.return_value = self._server_error_response("File not found")

        with self.assertRaises(MetadataReadError) as context:
            get_metadata("/tmp/photo.jpg", tags=["EXIF:Make"])

        self.assertIn("/tmp/photo.jpg", str(context.exception))
        self.assertIn("File not found", str(context.exception))
        # An ExifTool error comes back the same way every time.
        self.assertEqual(mock_post.call_count, 1)
