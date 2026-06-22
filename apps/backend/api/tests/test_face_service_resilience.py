"""Resilience tests for ``api.face_recognition._post_to_face_service``.

The face-recognition sidecar can transiently drop the connection while a scan
saturates the box — surfacing as ``requests.ConnectionError`` (the underlying
``http.client.RemoteDisconnected``) — or time out. A single such blip used to
fail the whole face, and enough of them tripped the job-failure threshold,
marking Scan Faces / Generate Face Embeddings as failed despite most faces
succeeding.

These tests assert the helper retries transient transport failures and gives
up gracefully, while NOT retrying status/JSON errors (which would fail the
same way).
"""

from unittest.mock import MagicMock, patch

import requests
from django.test import SimpleTestCase

from api.face_recognition import FACE_MAX_ATTEMPTS, _post_to_face_service


def _ok_response(json_body=None):
    response = MagicMock()
    response.status_code = 200
    response.ok = True
    response.json.return_value = json_body if json_body is not None else {}
    response.raise_for_status.return_value = None
    return response


def _status_error_response(status_code=400):
    response = MagicMock()
    response.status_code = status_code
    response.json.return_value = {"error": "bad request"}
    response.raise_for_status.side_effect = requests.HTTPError("boom")
    return response


class PostToFaceServiceResilienceTest(SimpleTestCase):
    @patch("api.face_recognition.time.sleep", return_value=None)
    @patch("api.face_recognition.requests.post")
    def test_retries_transient_drop_then_succeeds(self, mock_post, _sleep):
        mock_post.side_effect = [
            requests.ConnectionError("Remote end closed connection"),
            _ok_response({"encodings": []}),
        ]

        result = _post_to_face_service(
            "http://localhost:8005/face-encodings", {"source": "/tmp/p.jpg"}
        )

        self.assertEqual(result, {"encodings": []})
        self.assertEqual(mock_post.call_count, 2)

    @patch("api.face_recognition.time.sleep", return_value=None)
    @patch("api.face_recognition.requests.post")
    def test_gives_up_after_max_attempts(self, mock_post, _sleep):
        mock_post.side_effect = requests.ConnectionError("Remote end closed connection")

        with self.assertRaises(requests.ConnectionError):
            _post_to_face_service(
                "http://localhost:8005/face-encodings", {"source": "/tmp/p.jpg"}
            )

        self.assertEqual(mock_post.call_count, FACE_MAX_ATTEMPTS)

    @patch("api.face_recognition.time.sleep", return_value=None)
    @patch("api.face_recognition.requests.post")
    def test_status_error_is_not_retried(self, mock_post, _sleep):
        # A non-2xx status is not transient — retrying would fail identically.
        mock_post.return_value = _status_error_response(400)

        with self.assertRaises(requests.HTTPError):
            _post_to_face_service(
                "http://localhost:8005/face-encodings", {"source": "/tmp/p.jpg"}
            )

        self.assertEqual(mock_post.call_count, 1)
