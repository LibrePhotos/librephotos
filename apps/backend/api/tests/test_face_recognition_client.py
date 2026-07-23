from unittest.mock import MagicMock, patch

import requests
from django.test import SimpleTestCase

from api.face_recognition import get_face_locations


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

        self.assertIn("http://localhost:8005/face-locations", str(context.exception))
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

        self.assertIn("http://localhost:8005/face-locations", str(context.exception))
        self.assertIn("status 200", str(context.exception))
        # The body has to reach the message so an operator can see what the
        # service actually replied with, but an HTML error page is reduced to
        # its visible text first — dumping a whole Flask 500 page into the log
        # line is what _get_response_preview exists to prevent.
        self.assertIn("service error", str(context.exception))
        self.assertNotIn("<html>", str(context.exception))
