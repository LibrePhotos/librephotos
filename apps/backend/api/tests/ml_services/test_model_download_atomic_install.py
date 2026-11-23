"""Two downloads of one model never share a file, and a model lands whole.

A chained Download Models (``missing_models_prerequisites``, ``job_id=None``)
writes its own row without the instance-wide check, so it can run beside
another download. Both used to stream into the same ``<file>.part``. A zip
was unpacked straight into the model's directory, and that directory counts
as installed once any ``*.onnx`` is in it, so an extraction cut short left a
face model that was never downloaded again.
"""

import io
import tempfile
import zipfile
from pathlib import Path
from unittest.mock import patch

import requests
from django.test import SimpleTestCase, override_settings

from api.runtime import ml_models
from api.runtime.ml_models import _download_file, _model_target_exists, download_model


class _Response:
    status_code = 200

    def __init__(self, chunks, on_chunk=None):
        self._chunks = chunks
        self._on_chunk = on_chunk
        size = sum(len(chunk) for chunk in chunks)
        self.headers = {"content-length": str(size)}

    def __enter__(self):
        return self

    def __exit__(self, *exc_info):
        return False

    def raise_for_status(self):
        return None

    def iter_content(self, chunk_size=1):
        for number, chunk in enumerate(self._chunks):
            yield chunk
            if self._on_chunk is not None and number == 0:
                self._on_chunk()


class ConcurrentDownloadTest(SimpleTestCase):
    def test_a_second_download_mid_stream_does_not_mix_into_the_first(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            target = Path(temp_dir) / "model.onnx"

            def second_download():
                with patch(
                    "api.runtime.ml_models.requests.get",
                    return_value=_Response([b"BBBB", b"BBBB"]),
                ):
                    _download_file("https://example.invalid/m", target, "m")

            first = _Response([b"AAAA", b"AAAA"], on_chunk=second_download)
            with patch("api.runtime.ml_models.requests.get", return_value=first):
                _download_file("https://example.invalid/m", target, "m")

            self.assertEqual(target.read_bytes(), b"AAAAAAAA")
            self.assertEqual([p.name for p in Path(temp_dir).iterdir()], [target.name])


def _zip(members):
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, mode="w") as archive:
        for name, payload in members.items():
            archive.writestr(name, payload)
    return buffer.getvalue()


FACE_MODEL = {
    "id": 950,
    "name": "face_zip",
    "url": "https://example.invalid/face.zip",
    "type": ml_models.MlTypes.FACE_RECOGNITION,
    "unpack-command": "zip",
    "target-dir": "face_recognition/models/face_zip",
}


class AtomicInstallTest(SimpleTestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        media_root = Path(self.temp.name) / "protected_media"
        self.models = media_root / "data_models"
        self.enterContext(override_settings(MEDIA_ROOT=str(media_root)))
        self.enterContext(
            patch("api.runtime.ml_models._is_model_selected", return_value=True)
        )
        payload = _zip({"det.onnx": b"det", "rec.onnx": b"rec"})
        self.get = patch(
            "api.runtime.ml_models.requests.get",
            side_effect=lambda *a, **k: _Response([payload]),
        )

    def test_an_extraction_cut_short_installs_nothing(self):
        def half_extract(archive, path):
            Path(path, "det.onnx").write_bytes(b"det")
            raise OSError("disk full")

        with (
            self.get,
            patch.object(zipfile.ZipFile, "extractall", half_extract),
            self.assertRaises(OSError),
        ):
            download_model(FACE_MODEL)

        self.assertFalse(_model_target_exists(self.models, FACE_MODEL))
        self.assertEqual(list(self.models.rglob("*.onnx")), [])

    def test_a_whole_extraction_replaces_a_half_one(self):
        # Left by a version that unpacked in place, without its .onnx files.
        stale = self.models / FACE_MODEL["target-dir"]
        stale.mkdir(parents=True)
        (stale / "partial.txt").write_bytes(b"")

        with self.get:
            download_model(FACE_MODEL)

        self.assertEqual(
            sorted(p.name for p in stale.iterdir()), ["det.onnx", "rec.onnx"]
        )
        self.assertEqual(
            [p.name for p in (self.models / "face_recognition" / "models").iterdir()],
            ["face_zip"],
        )
        self.assertEqual(
            sorted(p.name for p in self.models.iterdir()),
            [".locks", "face_recognition"],
        )

    def test_a_failed_download_leaves_no_staging_behind(self):
        with (
            patch("api.runtime.ml_models.time.sleep"),
            patch(
                "api.runtime.ml_models.requests.get",
                side_effect=requests.ConnectionError("down"),
            ),
            self.assertRaises(requests.ConnectionError),
        ):
            download_model(FACE_MODEL)

        self.assertEqual([p.name for p in self.models.iterdir()], [".locks"])
