"""Tests for the ``api.face_recognition`` HTTP client to the face sidecar.

Covers two concerns of the same transport layer:

* Error reporting — failures from ``get_face_locations`` must name the URL, the
  HTTP status and a preview of the response body, so an operator can tell an
  empty 400 from a 500 with a traceback, and an HTML error page is reduced to
  its visible text first (what ``_get_response_preview`` exists to prevent).
* Resilience — the sidecar can transiently drop the connection while a scan
  saturates the box (``requests.ConnectionError`` wrapping
  ``http.client.RemoteDisconnected``) or time out. A single blip used to fail
  the whole face, and enough of them tripped the job-failure threshold, marking
  Scan Faces / Generate Face Embeddings as failed despite most faces
  succeeding. ``_post_to_face_service`` retries transient transport failures
  and gives up gracefully, while NOT retrying status/JSON errors (which would
  fail the same way).
"""

from unittest.mock import MagicMock, patch

import requests
from django.test import SimpleTestCase

from api.face_recognition import (
    FACE_MAX_ATTEMPTS,
    _post_to_face_service,
    detect_faces,
    get_face_encodings,
    get_face_locations,
)
from api.models.face import Face


class FaceRecognitionClientTest(SimpleTestCase):
    @patch("api.face_recognition.requests.post")
    @patch("api.face_recognition.site_config")
    def test_get_face_locations_includes_empty_http_response_details(
        self, mock_site_config, mock_post
    ):
        mock_site_config.FACE_RECOGNITION_MODEL = "buffalo_sc"

        mock_response = MagicMock()
        mock_response.status_code = 400
        mock_response.text = ""
        mock_response.raise_for_status.side_effect = requests.HTTPError(
            "400 Client Error"
        )
        mock_post.return_value = mock_response

        with self.assertRaises(requests.HTTPError) as context:
            get_face_locations("/tmp/image.jpg")

        self.assertIn("http://127.0.0.1:8005/face-locations", str(context.exception))
        self.assertIn("status 400", str(context.exception))
        self.assertIn("<empty body>", str(context.exception))

    @patch("api.face_recognition.requests.post")
    @patch("api.face_recognition.site_config")
    def test_get_face_locations_includes_http_response_body(
        self, mock_site_config, mock_post
    ):
        mock_site_config.FACE_RECOGNITION_MODEL = "buffalo_sc"

        mock_response = MagicMock()
        mock_response.status_code = 500
        mock_response.text = "model failed to load"
        mock_response.raise_for_status.side_effect = requests.HTTPError(
            "500 Server Error"
        )
        mock_post.return_value = mock_response

        with self.assertRaises(requests.HTTPError) as context:
            get_face_locations("/tmp/image.jpg")

        self.assertIn("status 500", str(context.exception))
        self.assertIn("model failed to load", str(context.exception))

    @patch("api.face_recognition.requests.post")
    @patch("api.face_recognition.site_config")
    def test_get_face_locations_includes_invalid_json_response_body(
        self, mock_site_config, mock_post
    ):
        mock_site_config.FACE_RECOGNITION_MODEL = "buffalo_sc"

        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.headers = {"Content-Type": "text/html"}
        mock_response.text = "<html>service error</html>"
        mock_response.raise_for_status.return_value = None
        mock_response.json.side_effect = ValueError("invalid json")
        mock_post.return_value = mock_response

        with self.assertRaises(ValueError) as context:
            get_face_locations("/tmp/image.jpg")

        self.assertIn("http://127.0.0.1:8005/face-locations", str(context.exception))
        self.assertIn("status 200", str(context.exception))
        # The body has to reach the message so an operator can see what the
        # service actually replied with, but an HTML error page is reduced to
        # its visible text first — dumping a whole Flask 500 page into the log
        # line is what _get_response_preview exists to prevent.
        self.assertIn("service error", str(context.exception))
        self.assertNotIn("<html>", str(context.exception))


class DetectFacesTest(SimpleTestCase):
    """One detection returns the faces and their encodings together."""

    @patch("api.face_recognition.requests.post")
    @patch("api.face_recognition.site_config")
    def test_encodings_come_with_the_locations(self, mock_site_config, mock_post):
        mock_site_config.FACE_RECOGNITION_MODEL = "buffalo_sc"
        mock_post.return_value = _ok_response(
            {
                "face_locations": [[1, 2, 3, 4], [5, 6, 7, 8]],
                "encodings": [[0.5, 0.25], [1.0, 2.0]],
            }
        )

        faces = detect_faces("/tmp/image.jpg")

        self.assertEqual(
            [location for location, _ in faces], [[1, 2, 3, 4], [5, 6, 7, 8]]
        )
        # float64, like get_face_encodings, so the stored hex is the same
        self.assertEqual(faces[0][1].dtype.name, "float64")
        self.assertEqual(faces[1][1].tolist(), [1.0, 2.0])
        mock_post.assert_called_once()

    @patch("api.face_recognition.requests.post")
    @patch("api.face_recognition.site_config")
    def test_older_sidecar_without_encodings(self, mock_site_config, mock_post):
        mock_site_config.FACE_RECOGNITION_MODEL = "buffalo_sc"
        mock_post.return_value = _ok_response({"face_locations": [[1, 2, 3, 4]]})

        self.assertEqual(detect_faces("/tmp/image.jpg"), [([1, 2, 3, 4], None)])
        self.assertEqual(get_face_locations("/tmp/image.jpg"), [[1, 2, 3, 4]])


class GetFaceEncodingsTest(SimpleTestCase):
    """A region the sidecar found no face at comes back as None, in its slot."""

    @patch("api.face_recognition.requests.post")
    @patch("api.face_recognition.site_config")
    def test_an_unmatched_region_is_none(self, mock_site_config, mock_post):
        mock_site_config.FACE_RECOGNITION_MODEL = "buffalo_sc"
        mock_post.return_value = _ok_response({"encodings": [None, [1.0, 2.0]]})

        encodings = get_face_encodings("/tmp/image.jpg", [(0, 1, 1, 0), (2, 3, 3, 2)])

        self.assertIsNone(encodings[0])
        self.assertEqual(encodings[1].tolist(), [1.0, 2.0])


class GenerateEncodingTest(SimpleTestCase):
    """Face.generate_encoding stores nothing for a region with no face in it."""

    def test_an_unmatched_region_raises_and_saves_nothing(self):
        face = MagicMock(id=7, encoding="")

        with patch("api.models.face.get_face_encodings", return_value=[None]):
            with self.assertRaisesRegex(ValueError, "no face"):
                Face.generate_encoding(face)

        self.assertEqual(face.encoding, "")
        face.save.assert_not_called()


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
