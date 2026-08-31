"""Characterization tests for ``api.ml_models.download_model`` / ``_download_file``.

These pin the CURRENT observed behaviour of the download pipeline before it is
refactored. They deliberately assert what the code does today, including the
quirks noted in the docstrings below.

Everything is mocked: no network, no real archives from disk, no ML runtime.
"""

import hashlib
import io
import tarfile
import tempfile
import zipfile
from pathlib import Path
from unittest.mock import patch

import requests
from constance.test import override_config
from django.test import TestCase, override_settings

from api.ml_models import (
    ML_MODELS,
    MlTypes,
    ModelChecksumError,
    _download_file,
    _get_download_target,
    download_model,
)


def _model_by_name(name):
    for model in ML_MODELS:
        if model["name"] == name:
            return model
    raise AssertionError(f"model {name} not found in ML_MODELS")


class _FakeResponse:
    """Minimal stand-in for a streamed ``requests`` response."""

    def __init__(self, chunks=(), status_code=200, headers=None):
        self._chunks = list(chunks)
        self.status_code = status_code
        self.headers = headers if headers is not None else {}

    def __enter__(self):
        return self

    def __exit__(self, *exc_info):
        return False

    def raise_for_status(self):
        if self.status_code >= 400:
            raise requests.HTTPError(f"{self.status_code} Error", response=self)

    def iter_content(self, chunk_size=1):
        yield from self._chunks


class _ExplodingResponse(_FakeResponse):
    """Yields a chunk, then blows up mid-stream."""

    def iter_content(self, chunk_size=1):
        for chunk in self._chunks:
            yield chunk
        raise requests.ConnectionError("connection reset mid-stream")


def _make_tar_gz_bytes(members):
    """Build an in-memory .tar.gz containing ``{path: bytes}``."""
    buffer = io.BytesIO()
    with tarfile.open(fileobj=buffer, mode="w:gz") as tar:
        for name, payload in members.items():
            info = tarfile.TarInfo(name=name)
            info.size = len(payload)
            tar.addfile(info, io.BytesIO(payload))
    return buffer.getvalue()


def _make_zip_bytes(members):
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, mode="w") as archive:
        for name, payload in members.items():
            archive.writestr(name, payload)
    return buffer.getvalue()


def _responder(payload):
    """A ``requests.get`` replacement returning a fresh response per call."""

    def _get(url, *args, **kwargs):
        return _FakeResponse(
            chunks=[payload],
            headers={"content-length": str(len(payload))},
        )

    return _get


# ---------------------------------------------------------------------------
# download_model
# ---------------------------------------------------------------------------


class DownloadModelSkipBranchesTest(TestCase):
    """The two early-return branches of ``download_model``."""

    @override_config(OCR_MODEL="None")
    def test_unselected_model_returns_without_downloading(self):
        model = _model_by_name("ppocrv6_small")
        with tempfile.TemporaryDirectory() as temp_dir:
            media_root = Path(temp_dir) / "protected_media"
            with override_settings(MEDIA_ROOT=str(media_root)):
                with patch("api.ml_models._download_file") as download_file:
                    self.assertIsNone(download_model(model))

            download_file.assert_not_called()
            # Not even the data_models folder is created on this path.
            self.assertFalse((media_root / "data_models").exists())

    @override_config(OCR_MODEL="ppocrv6_small")
    def test_already_installed_model_returns_without_downloading(self):
        model = _model_by_name("ppocrv6_small")
        with tempfile.TemporaryDirectory() as temp_dir:
            media_root = Path(temp_dir) / "protected_media"
            target_dir = media_root / "data_models" / model["target-dir"]
            target_dir.mkdir(parents=True)
            for name in ("det.onnx", "rec.onnx", "charset.txt", "config.json"):
                (target_dir / name).write_bytes(b"x")

            with override_settings(MEDIA_ROOT=str(media_root)):
                with patch("api.ml_models._download_file") as download_file:
                    self.assertIsNone(download_model(model))

            download_file.assert_not_called()

    @override_config(OCR_MODEL="ppocrv6_small")
    def test_half_extracted_bundle_triggers_a_fresh_download(self):
        # target-dir exists but the OCR completeness check fails -> download.
        model = _model_by_name("ppocrv6_small")
        with tempfile.TemporaryDirectory() as temp_dir:
            media_root = Path(temp_dir) / "protected_media"
            target_dir = media_root / "data_models" / model["target-dir"]
            target_dir.mkdir(parents=True)
            (target_dir / "det.onnx").write_bytes(b"x")

            with override_settings(MEDIA_ROOT=str(media_root)):
                with patch("api.ml_models._download_file") as download_file:
                    with patch("api.ml_models._unpack_archive") as unpack:
                        download_model(model)

            self.assertEqual(1, download_file.call_count)
            self.assertEqual(1, unpack.call_count)
            # The pinned sha256 is forwarded as the 4th positional argument.
            args = download_file.call_args[0]
            self.assertEqual(model["url"], args[0])
            self.assertEqual(model["name"], args[2])
            self.assertEqual(model["sha256"], args[3])


class DownloadModelUnpackTest(TestCase):
    """Unpack-command dispatch and archive cleanup, end to end but offline."""

    def test_tar_gz_model_is_extracted_and_archive_removed(self):
        payload = _make_tar_gz_bytes({"custom_tar/weights.bin": b"weights"})
        model = {
            "id": 900,
            "name": "custom_tar",
            "url": "https://example.invalid/custom.tar.gz",
            "type": "custom",
            "unpack-command": "tar -zxC",
            "target-dir": "custom_tar",
            "sha256": hashlib.sha256(payload).hexdigest(),
        }
        with tempfile.TemporaryDirectory() as temp_dir:
            media_root = Path(temp_dir) / "protected_media"
            model_folder = media_root / "data_models"
            with override_settings(MEDIA_ROOT=str(media_root)):
                with patch("api.ml_models.requests.get", _responder(payload)):
                    download_model(model)

            self.assertEqual(
                b"weights", (model_folder / "custom_tar" / "weights.bin").read_bytes()
            )
            # The archive (and its .part sibling) are gone.
            self.assertEqual(
                ["custom_tar"], sorted(p.name for p in model_folder.iterdir())
            )

    def test_zip_model_is_extracted_into_target_dir(self):
        payload = _make_zip_bytes({"w600k.onnx": b"onnx-bytes"})
        model = {
            "id": 901,
            "name": "custom_zip",
            "url": "https://example.invalid/custom.zip",
            "type": "custom",
            "unpack-command": "zip",
            "target-dir": "nested/custom_zip",
            "sha256": hashlib.sha256(payload).hexdigest(),
        }
        with tempfile.TemporaryDirectory() as temp_dir:
            media_root = Path(temp_dir) / "protected_media"
            model_folder = media_root / "data_models"
            with override_settings(MEDIA_ROOT=str(media_root)):
                with patch("api.ml_models.requests.get", _responder(payload)):
                    download_model(model)

            extracted = model_folder / "nested" / "custom_zip" / "w600k.onnx"
            self.assertEqual(b"onnx-bytes", extracted.read_bytes())
            self.assertFalse((model_folder / "nested" / "custom_zip.zip").exists())

    def test_plain_file_model_lands_at_target_dir_without_unpacking(self):
        payload = b"plain model bytes"
        model = {
            "id": 902,
            "name": "custom_plain",
            "url": "https://example.invalid/model.bin",
            "type": "custom",
            "unpack-command": None,
            "target-dir": "custom_plain.bin",
            "sha256": hashlib.sha256(payload).hexdigest(),
        }
        with tempfile.TemporaryDirectory() as temp_dir:
            media_root = Path(temp_dir) / "protected_media"
            model_folder = media_root / "data_models"
            with override_settings(MEDIA_ROOT=str(media_root)):
                with patch("api.ml_models._unpack_archive") as unpack:
                    with patch("api.ml_models.requests.get", _responder(payload)):
                        download_model(model)

            unpack.assert_not_called()
            self.assertEqual(payload, (model_folder / "custom_plain.bin").read_bytes())

    def test_unknown_unpack_command_leaves_the_downloaded_file_deleted(self):
        # BEHAVIOUR NOTE (pinned, arguably a bug): an unrecognised truthy
        # unpack-command makes _unpack_archive a no-op, but download_model's
        # ``finally`` still unlinks the downloaded file - so nothing survives
        # and no error is raised.
        payload = b"whatever"
        model = {
            "id": 903,
            "name": "custom_unknown",
            "url": "https://example.invalid/model.bin",
            "type": "custom",
            "unpack-command": "7z x",
            "target-dir": "custom_unknown",
            "sha256": hashlib.sha256(payload).hexdigest(),
        }
        with tempfile.TemporaryDirectory() as temp_dir:
            media_root = Path(temp_dir) / "protected_media"
            model_folder = media_root / "data_models"
            with override_settings(MEDIA_ROOT=str(media_root)):
                with patch("api.ml_models.requests.get", _responder(payload)):
                    download_model(model)

            self.assertEqual([], list(model_folder.iterdir()))

    def test_download_target_paths_per_unpack_command(self):
        folder = Path("/models")
        self.assertEqual(
            folder / "a.tar.gz",
            _get_download_target(
                folder, {"unpack-command": "tar -zxC", "target-dir": "a"}
            ),
        )
        self.assertEqual(
            folder / "a.tar",
            _get_download_target(
                folder, {"unpack-command": "tar -xvf", "target-dir": "a"}
            ),
        )
        self.assertEqual(
            folder / "a.zip",
            _get_download_target(folder, {"unpack-command": "zip", "target-dir": "a"}),
        )
        self.assertEqual(
            folder / "a",
            _get_download_target(folder, {"unpack-command": None, "target-dir": "a"}),
        )


class DownloadModelAdditionalFilesTest(TestCase):
    def _model(self, main_payload, extra_payload):
        return {
            "id": 904,
            "name": "custom_multi",
            "url": "https://example.invalid/main.bin",
            "type": "custom",
            "unpack-command": None,
            "target-dir": "multi/main.bin",
            "sha256": hashlib.sha256(main_payload).hexdigest(),
            "additional_files": [
                {
                    "url": "https://example.invalid/extra.bin",
                    "target": "multi/extra.bin",
                    "sha256": hashlib.sha256(extra_payload).hexdigest(),
                }
            ],
        }

    def test_additional_files_are_downloaded_after_the_main_artifact(self):
        main_payload = b"main"
        extra_payload = b"extra"
        model = self._model(main_payload, extra_payload)
        bodies = {
            "https://example.invalid/main.bin": main_payload,
            "https://example.invalid/extra.bin": extra_payload,
        }

        def fake_get(url, *args, **kwargs):
            body = bodies[url]
            return _FakeResponse(
                chunks=[body], headers={"content-length": str(len(body))}
            )

        with tempfile.TemporaryDirectory() as temp_dir:
            media_root = Path(temp_dir) / "protected_media"
            model_folder = media_root / "data_models"
            with override_settings(MEDIA_ROOT=str(media_root)):
                with patch("api.ml_models.requests.get", fake_get):
                    download_model(model)

            self.assertEqual(
                main_payload, (model_folder / "multi" / "main.bin").read_bytes()
            )
            self.assertEqual(
                extra_payload, (model_folder / "multi" / "extra.bin").read_bytes()
            )

    def test_present_additional_file_is_not_re_downloaded(self):
        main_payload = b"main"
        extra_payload = b"extra"
        model = self._model(main_payload, extra_payload)

        with tempfile.TemporaryDirectory() as temp_dir:
            media_root = Path(temp_dir) / "protected_media"
            model_folder = media_root / "data_models"
            (model_folder / "multi").mkdir(parents=True)
            (model_folder / "multi" / "extra.bin").write_bytes(b"already here")

            calls = []

            def fake_download(url, target_path, model_name, expected_sha256=None):
                calls.append(url)
                Path(target_path).parent.mkdir(parents=True, exist_ok=True)
                Path(target_path).write_bytes(main_payload)

            with override_settings(MEDIA_ROOT=str(media_root)):
                with patch("api.ml_models._download_file", side_effect=fake_download):
                    download_model(model)

            self.assertEqual(["https://example.invalid/main.bin"], calls)
            self.assertEqual(
                b"already here", (model_folder / "multi" / "extra.bin").read_bytes()
            )

    def test_additional_file_name_is_used_in_the_progress_label(self):
        model = self._model(b"main", b"extra")
        labels = []

        def fake_download(url, target_path, model_name, expected_sha256=None):
            labels.append(model_name)
            Path(target_path).parent.mkdir(parents=True, exist_ok=True)
            Path(target_path).write_bytes(b"x")

        with tempfile.TemporaryDirectory() as temp_dir:
            media_root = Path(temp_dir) / "protected_media"
            with override_settings(MEDIA_ROOT=str(media_root)):
                with patch("api.ml_models._download_file", side_effect=fake_download):
                    download_model(model)

        self.assertEqual(["custom_multi", "custom_multi (multi/extra.bin)"], labels)


class DownloadModelDoesNotMutateInputTest(TestCase):
    @override_config(OCR_MODEL="ppocrv6_small")
    def test_caller_dict_is_untouched(self):
        model = _model_by_name("ppocrv6_small")
        before = dict(model)
        with tempfile.TemporaryDirectory() as temp_dir:
            media_root = Path(temp_dir) / "protected_media"
            with override_settings(MEDIA_ROOT=str(media_root)):
                with patch("api.ml_models._download_file"):
                    with patch("api.ml_models._unpack_archive"):
                        download_model(model)
        self.assertEqual(before, model)


class DownloadModelFaceRecognitionExistsTest(TestCase):
    @override_config(FACE_RECOGNITION_MODEL="buffalo_sc")
    def test_target_dir_without_onnx_is_re_downloaded(self):
        model = _model_by_name("buffalo_sc")
        with tempfile.TemporaryDirectory() as temp_dir:
            media_root = Path(temp_dir) / "protected_media"
            (media_root / "data_models" / model["target-dir"]).mkdir(parents=True)

            with override_settings(MEDIA_ROOT=str(media_root)):
                with patch("api.ml_models._download_file") as download_file:
                    with patch("api.ml_models._unpack_archive"):
                        download_model(model)

            self.assertEqual(1, download_file.call_count)


# ---------------------------------------------------------------------------
# _download_file
# ---------------------------------------------------------------------------


class DownloadFileProgressTest(TestCase):
    def test_progress_is_logged_once_per_changed_percentage(self):
        # 4 chunks of 1024 over a 4096 byte body -> 25/50/75/100.
        payload = b"z" * 4096
        chunks = [payload[i : i + 1024] for i in range(0, 4096, 1024)]
        response = _FakeResponse(
            chunks=chunks, headers={"content-length": str(len(payload))}
        )
        with tempfile.TemporaryDirectory() as temp_dir:
            target = Path(temp_dir) / "model.bin"
            with patch("api.ml_models.requests.get", return_value=response):
                with patch("api.util.logger") as logger:
                    _download_file("https://example.invalid/x", target, "m")

            messages = [call.args[0] for call in logger.info.call_args_list]
            self.assertEqual(
                [
                    "Downloading m: 1024/4096 (25%)",
                    "Downloading m: 2048/4096 (50%)",
                    "Downloading m: 3072/4096 (75%)",
                    "Downloading m: 4096/4096 (100%)",
                ],
                messages,
            )

    def test_empty_chunks_are_skipped(self):
        payload = b"abc"
        response = _FakeResponse(
            chunks=[b"", b"a", b"", b"bc"],
            headers={"content-length": str(len(payload))},
        )
        with tempfile.TemporaryDirectory() as temp_dir:
            target = Path(temp_dir) / "model.bin"
            with patch("api.ml_models.requests.get", return_value=response):
                _download_file("https://example.invalid/x", target, "m")
            self.assertEqual(payload, target.read_bytes())

    def test_missing_content_length_skips_size_check_and_logs_unknown_size(self):
        payload = b"no content length here"
        response = _FakeResponse(chunks=[payload], headers={})
        with tempfile.TemporaryDirectory() as temp_dir:
            target = Path(temp_dir) / "model.bin"
            with patch("api.ml_models.requests.get", return_value=response):
                with patch("api.util.logger") as logger:
                    _download_file("https://example.invalid/x", target, "m")

            self.assertEqual(payload, target.read_bytes())
            messages = [call.args[0] for call in logger.info.call_args_list]
            self.assertEqual(
                [f"Downloaded m: {len(payload)} bytes (size unknown during transfer)"],
                messages,
            )

    def test_longer_than_advertised_body_is_also_rejected(self):
        response = _FakeResponse(chunks=[b"x" * 100], headers={"content-length": "50"})
        with tempfile.TemporaryDirectory() as temp_dir:
            target = Path(temp_dir) / "model.bin"
            with patch("api.ml_models.requests.get", return_value=response):
                with self.assertRaises(OSError) as ctx:
                    _download_file("https://example.invalid/x", target, "m")

            self.assertIn(
                "Incomplete download for m: got 100 of 50 bytes", str(ctx.exception)
            )
            self.assertEqual([], list(target.parent.iterdir()))

    def test_identity_content_encoding_still_enforces_the_size_check(self):
        response = _FakeResponse(
            chunks=[b"half"],
            headers={"content-length": "2048", "content-encoding": "identity"},
        )
        with tempfile.TemporaryDirectory() as temp_dir:
            target = Path(temp_dir) / "model.bin"
            with patch("api.ml_models.requests.get", return_value=response):
                with self.assertRaises(OSError):
                    _download_file("https://example.invalid/x", target, "m")

    def test_mid_stream_connection_error_removes_the_partial_file(self):
        response = _ExplodingResponse(
            chunks=[b"partial"], headers={"content-length": "4096"}
        )
        with tempfile.TemporaryDirectory() as temp_dir:
            target = Path(temp_dir) / "sub" / "model.bin"
            with patch("api.ml_models.requests.get", return_value=response):
                with self.assertRaises(requests.ConnectionError):
                    _download_file("https://example.invalid/x", target, "m")

            self.assertFalse(target.exists())
            self.assertEqual([], list(target.parent.iterdir()))

    def test_a_stale_part_file_is_overwritten(self):
        payload = b"fresh bytes"
        response = _FakeResponse(
            chunks=[payload], headers={"content-length": str(len(payload))}
        )
        with tempfile.TemporaryDirectory() as temp_dir:
            target = Path(temp_dir) / "model.bin"
            stale = target.with_name(target.name + ".part")
            stale.write_bytes(b"leftover from a previous crashed run")

            with patch("api.ml_models.requests.get", return_value=response):
                _download_file("https://example.invalid/x", target, "m")

            self.assertEqual(payload, target.read_bytes())
            self.assertFalse(stale.exists())

    def test_existing_target_is_replaced_atomically(self):
        payload = b"new"
        response = _FakeResponse(
            chunks=[payload], headers={"content-length": str(len(payload))}
        )
        with tempfile.TemporaryDirectory() as temp_dir:
            target = Path(temp_dir) / "model.bin"
            target.write_bytes(b"old contents")
            with patch("api.ml_models.requests.get", return_value=response):
                _download_file("https://example.invalid/x", target, "m")
            self.assertEqual(payload, target.read_bytes())

    def test_uppercase_expected_digest_is_accepted(self):
        payload = b"case insensitive pin"
        digest = hashlib.sha256(payload).hexdigest().upper()
        response = _FakeResponse(
            chunks=[payload], headers={"content-length": str(len(payload))}
        )
        with tempfile.TemporaryDirectory() as temp_dir:
            target = Path(temp_dir) / "model.bin"
            with patch("api.ml_models.requests.get", return_value=response):
                _download_file("https://example.invalid/x", target, "m", digest)
            self.assertEqual(payload, target.read_bytes())

    def test_checksum_mismatch_logs_and_raises_with_both_digests(self):
        payload = b"a" * 32
        wrong = hashlib.sha256(b"different").hexdigest()
        actual = hashlib.sha256(payload).hexdigest()
        response = _FakeResponse(
            chunks=[payload], headers={"content-length": str(len(payload))}
        )
        with tempfile.TemporaryDirectory() as temp_dir:
            target = Path(temp_dir) / "model.bin"
            with patch("api.ml_models.requests.get", return_value=response):
                with patch("api.util.logger") as logger:
                    with self.assertRaises(ModelChecksumError) as ctx:
                        _download_file("https://example.invalid/x", target, "m", wrong)

            message = str(ctx.exception)
            self.assertIn(f"expected sha256 {wrong}", message)
            self.assertIn(f"got {actual}", message)
            logger.error.assert_called_once()
            self.assertIn("Checksum mismatch for m", logger.error.call_args[0][0])

    def test_no_pin_logs_a_debug_line_and_skips_verification(self):
        payload = b"unpinned"
        response = _FakeResponse(
            chunks=[payload], headers={"content-length": str(len(payload))}
        )
        with tempfile.TemporaryDirectory() as temp_dir:
            target = Path(temp_dir) / "model.bin"
            with patch("api.ml_models.requests.get", return_value=response):
                with patch("api.util.logger") as logger:
                    _download_file("https://example.invalid/x", target, "m")

            logger.debug.assert_called_once_with(
                "No sha256 pin for m; skipping verification"
            )

    def test_size_check_runs_before_checksum_verification(self):
        # A truncated body with a matching-for-the-partial digest still fails
        # with OSError, not ModelChecksumError.
        partial = b"half"
        response = _FakeResponse(chunks=[partial], headers={"content-length": "2048"})
        with tempfile.TemporaryDirectory() as temp_dir:
            target = Path(temp_dir) / "model.bin"
            with patch("api.ml_models.requests.get", return_value=response):
                with self.assertRaises(OSError):
                    _download_file(
                        "https://example.invalid/x",
                        target,
                        "m",
                        hashlib.sha256(partial).hexdigest(),
                    )

    def test_parent_directories_are_created(self):
        payload = b"deep"
        response = _FakeResponse(
            chunks=[payload], headers={"content-length": str(len(payload))}
        )
        with tempfile.TemporaryDirectory() as temp_dir:
            target = Path(temp_dir) / "a" / "b" / "c" / "model.bin"
            with patch("api.ml_models.requests.get", return_value=response):
                _download_file("https://example.invalid/x", target, "m")
            self.assertTrue(target.exists())

    def test_string_target_path_is_accepted(self):
        payload = b"str path"
        response = _FakeResponse(
            chunks=[payload], headers={"content-length": str(len(payload))}
        )
        with tempfile.TemporaryDirectory() as temp_dir:
            target = Path(temp_dir) / "model.bin"
            with patch("api.ml_models.requests.get", return_value=response):
                _download_file("https://example.invalid/x", str(target), "m")
            self.assertEqual(payload, target.read_bytes())

    def test_request_is_streamed_and_follows_redirects(self):
        payload = b"opts"
        response = _FakeResponse(
            chunks=[payload], headers={"content-length": str(len(payload))}
        )
        with tempfile.TemporaryDirectory() as temp_dir:
            target = Path(temp_dir) / "model.bin"
            with patch("api.ml_models.requests.get", return_value=response) as get:
                _download_file("https://example.invalid/x", target, "m")

            get.assert_called_once_with(
                "https://example.invalid/x", stream=True, allow_redirects=True
            )


class MlTypesConstantsTest(TestCase):
    def test_every_model_entry_has_a_known_type(self):
        known = {
            getattr(MlTypes, attr) for attr in dir(MlTypes) if not attr.startswith("_")
        }
        for model in ML_MODELS:
            self.assertIn(model["type"], known, model["name"])
