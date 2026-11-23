"""One download of a model at a time, and a flaky mirror does not fail it.

1.6.0 reports: the startup download and a chained Download Models fetched the
same model at once (FileNotFoundError at the ``os.replace``, WinError 32 on
Windows), and the Hugging Face CDN timing out mid-file failed the whole
model, hundreds of megabytes in, with nothing kept for the next try.
"""

import hashlib
import tempfile
import threading
from pathlib import Path
from unittest.mock import patch

import requests
from django.test import SimpleTestCase, override_settings

from api.runtime import ml_models
from api.runtime.ml_models import _download_file, download_model

PLAIN_MODEL: ml_models.MlModel = {
    "id": 951,
    "name": "plain_model",
    "url": "https://example.invalid/visual.onnx",
    "type": ml_models.MlTypes.CLIP,
    "unpack-command": None,
    "target-dir": "plain_model/visual.onnx",
    "additional_files": [
        {"url": "https://example.invalid/textual.onnx", "target": "plain_model/t.onnx"}
    ],
}


class _Response:
    def __init__(self, chunks, status_code=200, headers=None, fail_after=False):
        self._chunks = chunks
        self._fail_after = fail_after
        self.status_code = status_code
        self.headers = headers or {
            "content-length": str(sum(len(chunk) for chunk in chunks))
        }

    def __enter__(self):
        return self

    def __exit__(self, *exc_info):
        return False

    def raise_for_status(self):
        if self.status_code >= 400:
            raise requests.HTTPError(f"{self.status_code} Error", response=self)

    def iter_content(self, chunk_size=1):
        yield from self._chunks
        if self._fail_after:
            raise requests.ConnectionError("Read timed out.")


class ConcurrentModelDownloadTest(SimpleTestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.models = Path(temp.name) / "protected_media" / "data_models"
        self.enterContext(
            override_settings(MEDIA_ROOT=str(self.models.parent)),
        )
        self.enterContext(
            patch("api.runtime.ml_models._is_model_selected", return_value=True)
        )

    def test_a_second_download_waits_and_then_finds_the_model_installed(self):
        fetched: list[str] = []
        second_fetched = threading.Event()
        errors: list[BaseException] = []

        def second_download():
            try:
                download_model(PLAIN_MODEL)
            except BaseException as error:
                errors.append(error)
                raise

        second = threading.Thread(target=second_download)

        class _Slow(_Response):
            def iter_content(self, chunk_size=1):
                yield b"AAAA"
                second.start()
                second_fetched.wait(timeout=1)
                yield b"AAAA"

        def get(url, **kwargs):
            fetched.append(url)
            if len(fetched) == 1:
                return _Slow([b"AAAA", b"AAAA"])
            second_fetched.set()
            return _Response([b"BBBB", b"BBBB"])

        with patch("api.runtime.ml_models.requests.get", side_effect=get):
            download_model(PLAIN_MODEL)
            second.join(timeout=10)

        self.assertEqual(errors, [])
        self.assertEqual(
            fetched,
            [
                "https://example.invalid/visual.onnx",
                "https://example.invalid/textual.onnx",
            ],
        )
        self.assertEqual(
            (self.models / "plain_model" / "visual.onnx").read_bytes(), b"AAAAAAAA"
        )


@patch("api.runtime.ml_models.time.sleep")
class TransientDownloadErrorTest(SimpleTestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.target = Path(temp.name) / "model.onnx"

    def test_a_read_timeout_before_the_body_is_retried(self, sleep):
        responses = [requests.ReadTimeout("Read timed out."), _Response([b"model"])]
        with patch("api.runtime.ml_models.requests.get", side_effect=responses):
            _download_file("https://example.invalid/m", self.target, "m")

        self.assertEqual(self.target.read_bytes(), b"model")
        sleep.assert_called_once()

    def test_a_stream_cut_mid_file_resumes_from_the_bytes_received(self, sleep):
        whole = b"AAAABBBB"
        responses = [
            _Response([b"AAAA"], headers={"content-length": "8"}, fail_after=True),
            _Response(
                [b"BBBB"],
                status_code=206,
                headers={"content-length": "4", "content-range": "bytes 4-7/8"},
            ),
        ]
        with patch("api.runtime.ml_models.requests.get", side_effect=responses) as get:
            _download_file(
                "https://example.invalid/m",
                self.target,
                "m",
                hashlib.sha256(whole).hexdigest(),
            )

        self.assertEqual(self.target.read_bytes(), whole)
        self.assertEqual(get.call_args_list[0].kwargs["headers"], {})
        self.assertEqual(
            get.call_args_list[1].kwargs["headers"],
            {"Range": "bytes=4-", "Accept-Encoding": "identity"},
        )

    def test_a_server_ignoring_the_range_sends_the_file_again(self, sleep):
        whole = b"AAAABBBB"
        responses = [
            _Response([b"AAAA"], headers={"content-length": "8"}, fail_after=True),
            _Response([whole]),
        ]
        with patch("api.runtime.ml_models.requests.get", side_effect=responses):
            _download_file(
                "https://example.invalid/m",
                self.target,
                "m",
                hashlib.sha256(whole).hexdigest(),
            )

        self.assertEqual(self.target.read_bytes(), whole)

    def test_a_decompressed_body_cut_short_starts_over(self, sleep):
        whole = b"AAAABBBB"
        gzip = {"content-length": "6", "content-encoding": "gzip"}
        responses = [
            _Response([b"AAAA"], headers=gzip, fail_after=True),
            _Response([whole], headers=gzip),
        ]
        with patch("api.runtime.ml_models.requests.get", side_effect=responses) as get:
            _download_file("https://example.invalid/m", self.target, "m")

        self.assertEqual(self.target.read_bytes(), whole)
        self.assertEqual(get.call_args_list[1].kwargs["headers"], {})

    def test_retries_are_bounded_and_leave_nothing_behind(self, sleep):
        with (
            patch(
                "api.runtime.ml_models.requests.get",
                side_effect=requests.ConnectionError("refused"),
            ) as get,
            self.assertRaises(requests.ConnectionError),
        ):
            _download_file("https://example.invalid/m", self.target, "m")

        self.assertEqual(get.call_count, ml_models.DOWNLOAD_ATTEMPTS)
        self.assertEqual(list(self.target.parent.iterdir()), [])

    def test_an_http_error_is_not_retried(self, sleep):
        with (
            patch(
                "api.runtime.ml_models.requests.get",
                return_value=_Response([b"Entry not found"], status_code=404),
            ) as get,
            self.assertRaises(requests.HTTPError),
        ):
            _download_file("https://example.invalid/m", self.target, "m")

        self.assertEqual(get.call_count, 1)
        sleep.assert_not_called()
