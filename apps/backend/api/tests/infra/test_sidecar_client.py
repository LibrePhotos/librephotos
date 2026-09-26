"""The one HTTP client the backend calls its sidecars with (api.sidecars).

Exercised against a real HTTP server on loopback, so the retry policy is the
one urllib3 actually applies, not a reading of its configuration.
"""

import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from unittest.mock import patch

import requests
from django.test import SimpleTestCase

from api import sidecars


class _Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def _answer(self):
        server = self.server
        server.hits += 1
        length = int(self.headers.get("Content-Length") or 0)
        if length:
            self.rfile.read(length)
        status, body, delay = server.replies[min(server.hits, len(server.replies)) - 1]
        if delay:
            time.sleep(delay)
        payload = body.encode()
        try:
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)
        except OSError:
            # The client timed out and hung up; that is what the test wanted.
            pass

    do_GET = _answer
    do_POST = _answer


class _Server:
    """A loopback server answering with *replies* in turn, the last one repeated."""

    def __init__(self, *replies):
        self.httpd = ThreadingHTTPServer(("127.0.0.1", 0), _Handler)
        self.httpd.replies = replies
        self.httpd.hits = 0
        self.thread = threading.Thread(target=self.httpd.serve_forever, daemon=True)

    @property
    def hits(self):
        return self.httpd.hits

    def __enter__(self):
        self.thread.start()
        port = self.httpd.server_address[1]
        self.patch = patch.dict(sidecars.SERVICES, {"exif": port})
        self.patch.start()
        return self

    def __exit__(self, *exc):
        self.patch.stop()
        self.httpd.shutdown()
        self.httpd.server_close()


def _closed_port():
    import socket

    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


# Keep the backoff out of the test run.
@patch.object(sidecars, "RETRY_BACKOFF", 0)
class SidecarClientTest(SimpleTestCase):
    def setUp(self):
        # Every test builds its session afresh with the patched policy.
        sidecars.http._session = None

    def tearDown(self):
        sidecars.http._session = None

    def test_a_503_is_retried_until_the_sidecar_answers(self):
        with _Server((503, "{}", 0), (503, "{}", 0), (200, '{"ok": 1}', 0)) as server:
            response = sidecars.post("exif", "/get-tags", json={}, timeout=(1, 5))
        self.assertEqual(response.json(), {"ok": 1})
        self.assertEqual(server.hits, 3)

    def test_a_503_that_persists_raises_with_the_reply(self):
        with _Server((503, '{"error": "busy"}', 0)) as server:
            with self.assertRaises(requests.HTTPError) as caught:
                sidecars.post("exif", "/get-tags", json={}, timeout=(1, 5))
        self.assertEqual(server.hits, 1 + sidecars.MAX_RETRIES)
        self.assertEqual(sidecars.error_detail(caught.exception), "busy")

    def test_an_error_status_is_raised_not_retried(self):
        with _Server((500, '{"error": "ExifTool died"}', 0)) as server:
            with self.assertRaises(requests.HTTPError) as caught:
                sidecars.post("exif", "/get-tags", json={}, timeout=(1, 5))
        self.assertEqual(server.hits, 1)
        self.assertEqual(caught.exception.response.status_code, 500)
        self.assertEqual(sidecars.error_detail(caught.exception), "ExifTool died")

    def test_a_refused_connection_is_retried_then_raised(self):
        with patch.dict(sidecars.SERVICES, {"exif": _closed_port()}):
            with patch.object(
                sidecars._SidecarRetry,
                "increment",
                autospec=True,
                side_effect=sidecars._SidecarRetry.increment,
            ) as increment:
                with self.assertRaises(requests.ConnectionError):
                    sidecars.get("exif", "/health", timeout=(1, 1))
        self.assertEqual(increment.call_count, 1 + sidecars.MAX_RETRIES)

    def test_a_read_timeout_is_not_retried(self):
        with _Server((200, "{}", 1.5)) as server:
            with self.assertRaises(requests.Timeout):
                sidecars.post("exif", "/get-tags", json={}, timeout=(1, 0.3))
        self.assertEqual(server.hits, 1)

    def test_a_child_process_builds_its_own_session(self):
        first = sidecars.http.session()
        self.assertIs(sidecars.http.session(), first)
        with patch("api.sidecars.os.getpid", return_value=-1):
            self.assertIsNot(sidecars.http.session(), first)


class ErrorDetailTest(SimpleTestCase):
    def test_falls_back_to_the_error_without_a_json_reason(self):
        self.assertEqual(sidecars.error_detail(ValueError("x")), "x")
