"""The RAW thumbnail sidecar answers a malformed request with 400 and renders nothing.

Ported from the pytest module ``service/thumbnail/test/test_thumbnail_worker.py``
that Django's runner never found. Its success case already lives in
``test_thumbnail_service_raw.py``.
"""

from unittest.mock import patch

from django.test import SimpleTestCase

from service.thumbnail.main import app

BAD_REQUEST = 400

INCOMPLETE_PAYLOADS = [
    {"source": "foo"},
    {"destination": "/tmp/result.webp"},
    {"height": 100},
    {"source": "foo", "destination": "/tmp/result.webp"},
    {"destination": "/tmp/result.webp", "height": 100},
    {"height": 100, "source": "foo"},
]


class ThumbnailPayloadTests(SimpleTestCase):
    def setUp(self):
        render = patch("service.thumbnail.main.render_raw")
        self.render = render.start()
        self.addCleanup(render.stop)
        self.client = app.test_client()

    def test_an_empty_body_is_refused(self):
        response = self.client.post("/", data="")

        self.assertEqual(response.status_code, BAD_REQUEST)
        self.render.assert_not_called()

    def test_a_body_that_is_not_json_is_refused(self):
        response = self.client.post("/", data="invalid json")

        self.assertEqual(response.status_code, BAD_REQUEST)
        self.render.assert_not_called()

    def test_a_payload_missing_a_required_field_is_refused(self):
        for payload in INCOMPLETE_PAYLOADS:
            with self.subTest(payload=payload):
                response = self.client.post("/", json=payload)

                self.assertEqual(response.status_code, BAD_REQUEST)
                self.render.assert_not_called()
