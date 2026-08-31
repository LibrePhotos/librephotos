"""ML model requirements: selection, existence checks, and download pipeline."""

import hashlib
import re
import tarfile
import tempfile
from pathlib import Path
from unittest.mock import patch

import requests
from constance.test import override_config
from django.test import TestCase, override_settings

from api.ml_models import (
    ML_MODELS,
    ModelChecksumError,
    MlTypes,
    _download_file,
    _is_model_selected,
    _iter_required_models,
    _model_target_exists,
    do_all_models_exist,
    download_model,
    download_models,
)
from api.models.long_running_job import LongRunningJob
from api.tests.utils import create_test_user


def _ocr_model(tier):
    name = f"ppocrv6_{tier}"
    for model in ML_MODELS:
        if model["type"] == MlTypes.OCR and model["name"] == name:
            return model
    raise AssertionError(f"OCR model {name} not found in ML_MODELS")


class MlModelsTest(TestCase):
    def _create_required_models(self, model_root: Path):
        (model_root / "im2txt").mkdir(parents=True)
        (model_root / "clip-embeddings").mkdir(parents=True)
        (model_root / "places365").mkdir(parents=True)
        (model_root / "resnet18-5c106cde.pth").write_bytes(b"model")

    @override_config(
        CAPTIONING_MODEL="im2txt",
        LLM_MODEL="None",
        TAGGING_MODEL="places365",
        FACE_RECOGNITION_MODEL="buffalo_sc",
    )
    def test_do_all_models_exist_only_requires_selected_face_model(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            media_root = Path(temp_dir) / "protected_media"
            model_root = media_root / "data_models"
            self._create_required_models(model_root)
            selected_face_model = (
                model_root / "face_recognition" / "models" / "buffalo_sc"
            )
            selected_face_model.mkdir(parents=True)
            (selected_face_model / "w600k_mbf.onnx").write_bytes(b"model")

            with override_settings(MEDIA_ROOT=str(media_root)):
                self.assertTrue(do_all_models_exist())

    @override_config(
        CAPTIONING_MODEL="im2txt",
        LLM_MODEL="None",
        TAGGING_MODEL="places365",
        FACE_RECOGNITION_MODEL="buffalo_l",
    )
    def test_do_all_models_exist_requires_active_face_model(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            media_root = Path(temp_dir) / "protected_media"
            model_root = media_root / "data_models"
            self._create_required_models(model_root)
            unselected_face_model = (
                model_root / "face_recognition" / "models" / "buffalo_sc"
            )
            unselected_face_model.mkdir(parents=True)
            (unselected_face_model / "w600k_mbf.onnx").write_bytes(b"model")

            with override_settings(MEDIA_ROOT=str(media_root)):
                self.assertFalse(do_all_models_exist())


class OcrModelSelectionTest(TestCase):
    @override_config(OCR_MODEL="None")
    def test_ocr_models_not_selected_when_none(self):
        for tier in ("tiny", "small", "medium"):
            self.assertFalse(_is_model_selected(_ocr_model(tier)))

    @override_config(OCR_MODEL="ppocrv6_small")
    def test_only_matching_ocr_tier_is_selected(self):
        self.assertTrue(_is_model_selected(_ocr_model("small")))
        self.assertFalse(_is_model_selected(_ocr_model("tiny")))
        self.assertFalse(_is_model_selected(_ocr_model("medium")))

    @override_config(OCR_MODEL="")
    def test_empty_ocr_model_is_not_selected(self):
        self.assertFalse(_is_model_selected(_ocr_model("small")))


class OcrModelTargetExistsTest(TestCase):
    REQUIRED = ("det.onnx", "rec.onnx", "charset.txt", "config.json")

    def _make_bundle(self, model_folder, model, files):
        target_dir = model_folder / model["target-dir"]
        target_dir.mkdir(parents=True)
        for name in files:
            (target_dir / name).write_bytes(b"x")
        return target_dir

    def test_complete_bundle_exists(self):
        model = _ocr_model("small")
        with tempfile.TemporaryDirectory() as temp_dir:
            model_folder = Path(temp_dir) / "data_models"
            self._make_bundle(model_folder, model, self.REQUIRED)
            self.assertTrue(_model_target_exists(model_folder, model))

    def test_half_extracted_bundle_is_incomplete(self):
        model = _ocr_model("small")
        # Every case where exactly one required file is missing must be caught.
        for missing in self.REQUIRED:
            present = [f for f in self.REQUIRED if f != missing]
            with tempfile.TemporaryDirectory() as temp_dir:
                model_folder = Path(temp_dir) / "data_models"
                self._make_bundle(model_folder, model, present)
                self.assertFalse(
                    _model_target_exists(model_folder, model),
                    f"expected incomplete bundle (missing {missing}) to be False",
                )

    def test_missing_target_dir_is_false(self):
        model = _ocr_model("small")
        with tempfile.TemporaryDirectory() as temp_dir:
            model_folder = Path(temp_dir) / "data_models"
            model_folder.mkdir(parents=True)
            self.assertFalse(_model_target_exists(model_folder, model))


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


class DownloadFileTest(TestCase):
    """A download either lands complete, or it lands nothing at all."""

    def test_error_response_body_is_not_written(self):
        # Hugging Face answers a missing file with a 15 byte "Entry not found"
        # body, which used to be saved as the model and later blow up as a
        # corrupt archive far away from the actual cause.
        body = b"Entry not found"
        response = _FakeResponse(
            chunks=[body],
            status_code=404,
            headers={"content-length": str(len(body))},
        )
        with tempfile.TemporaryDirectory() as temp_dir:
            target = Path(temp_dir) / "ocr" / "ppocrv6_small.tar.gz"
            with patch("api.ml_models.requests.get", return_value=response):
                with self.assertRaises(requests.HTTPError):
                    _download_file("https://example.invalid/x", target, "ppocrv6_small")

            self.assertFalse(target.exists())
            self.assertEqual([], list(target.parent.iterdir()))

    def test_successful_download_is_written(self):
        payload = b"a" * 2048
        response = _FakeResponse(
            chunks=[payload[:1024], payload[1024:]],
            headers={"content-length": str(len(payload))},
        )
        with tempfile.TemporaryDirectory() as temp_dir:
            target = Path(temp_dir) / "nested" / "model.onnx"
            with patch("api.ml_models.requests.get", return_value=response):
                _download_file("https://example.invalid/x", target, "model")

            self.assertEqual(payload, target.read_bytes())
            self.assertEqual([target], list(target.parent.iterdir()))

    def test_truncated_download_is_rejected(self):
        response = _FakeResponse(
            chunks=[b"half"],
            headers={"content-length": "2048"},
        )
        with tempfile.TemporaryDirectory() as temp_dir:
            target = Path(temp_dir) / "model.onnx"
            with patch("api.ml_models.requests.get", return_value=response):
                with self.assertRaises(OSError):
                    _download_file("https://example.invalid/x", target, "model")

            self.assertFalse(target.exists())
            self.assertEqual([], list(target.parent.iterdir()))

    def test_transparently_decompressed_body_is_not_treated_as_truncated(self):
        # requests decodes content-encoding on the fly, so the bytes written can
        # legitimately differ from the advertised content-length.
        payload = b"decompressed payload, longer than the encoded body"
        response = _FakeResponse(
            chunks=[payload],
            headers={"content-length": "10", "content-encoding": "gzip"},
        )
        with tempfile.TemporaryDirectory() as temp_dir:
            target = Path(temp_dir) / "model.onnx"
            with patch("api.ml_models.requests.get", return_value=response):
                _download_file("https://example.invalid/x", target, "model")

            self.assertEqual(payload, target.read_bytes())


@override_config(OCR_MODEL="ppocrv6_small")
class DownloadModelFailureTest(TestCase):
    def test_corrupt_archive_is_not_left_behind(self):
        model = _ocr_model("small")
        with tempfile.TemporaryDirectory() as temp_dir:
            media_root = Path(temp_dir) / "protected_media"
            model_folder = media_root / "data_models"
            archive = model_folder / (model["target-dir"] + ".tar.gz")

            def fake_download(url, target_path, model_name, expected_sha256=None):
                target_path = Path(target_path)
                target_path.parent.mkdir(parents=True, exist_ok=True)
                target_path.write_bytes(b"Entry not found")

            with override_settings(MEDIA_ROOT=str(media_root)):
                with patch("api.ml_models._download_file", side_effect=fake_download):
                    with self.assertRaises(tarfile.ReadError):
                        download_model(model)

            self.assertFalse(archive.exists())
            self.assertFalse(_model_target_exists(model_folder, model))


class DownloadModelsJobTest(TestCase):
    def setUp(self):
        self.user = create_test_user()

    def test_one_failing_model_does_not_stop_the_others(self):
        attempted = []

        def fake_download_model(model):
            attempted.append(model["name"])
            if model["name"] == "places365":
                raise requests.HTTPError("404 Error")

        with tempfile.TemporaryDirectory() as temp_dir:
            with override_settings(MEDIA_ROOT=str(Path(temp_dir) / "protected_media")):
                with patch(
                    "api.ml_models.download_model", side_effect=fake_download_model
                ):
                    download_models(self.user)

        self.assertEqual([m["name"] for m in ML_MODELS], attempted)

        job = LongRunningJob.objects.get(job_type=LongRunningJob.JOB_DOWNLOAD_MODELS)
        self.assertTrue(job.failed)
        self.assertTrue(job.finished)
        self.assertIn("places365", job.result["error"])
        self.assertEqual(len(ML_MODELS), job.progress_current)

    def test_job_completes_when_every_model_downloads(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            with override_settings(MEDIA_ROOT=str(Path(temp_dir) / "protected_media")):
                with patch("api.ml_models.download_model"):
                    download_models(self.user)

        job = LongRunningJob.objects.get(job_type=LongRunningJob.JOB_DOWNLOAD_MODELS)
        self.assertFalse(job.failed)
        self.assertTrue(job.finished)


_SHA256_RE = re.compile(r"^[0-9a-fA-F]{40,}$")


class ModelChecksumPinTest(TestCase):
    """Every model artifact must carry a plausible sha256 pin.

    The guard is what keeps a future entry from being added unpinned and thus
    silently skipping verification.
    """

    def _assert_pinned(self, sha256, where):
        self.assertIsInstance(sha256, str, f"{where} sha256 must be a string")
        self.assertTrue(sha256, f"{where} sha256 must not be empty")
        self.assertRegex(
            sha256,
            _SHA256_RE,
            f"{where} sha256 must be 40+ hex characters",
        )

    def test_every_entry_and_additional_file_is_pinned(self):
        for model in ML_MODELS:
            self._assert_pinned(model.get("sha256"), model["name"])
            for additional_file in model.get("additional_files", []):
                self._assert_pinned(
                    additional_file.get("sha256"),
                    f"{model['name']} -> {additional_file['target']}",
                )


class ModelSourceUrlTest(TestCase):
    """The licensing / mirroring decisions are encoded as regression tests."""

    def _model(self, name):
        for model in ML_MODELS:
            if model["name"] == name:
                return model
        raise AssertionError(f"model {name} not found in ML_MODELS")

    def test_insightface_models_stay_on_upstream_github(self):
        # buffalo_* and antelopev2 are NON-COMMERCIAL-RESEARCH licensed, so they
        # must never be moved onto the LibrePhotos mirror. This test fails loudly
        # if someone re-points them.
        for name in ("buffalo_sc", "buffalo_s", "buffalo_m", "buffalo_l", "antelopev2"):
            self.assertIn(
                "github.com/deepinsight/insightface",
                self._model(name)["url"],
                f"{name} must stay on its upstream InsightFace release URL",
            )

    def test_mirrored_models_point_at_librephotos_mirror(self):
        mirror = "huggingface.co/derneuere/librephotos_models"

        siglip2 = self._model("siglip2")
        moondream = self._model("moondream")

        expected_mirrored = [
            self._model("mistral-7b-instruct-v0.2.Q5_K_M")["url"],
            siglip2["url"],
            siglip2["additional_files"][0]["url"],
            siglip2["additional_files"][1]["url"],
            moondream["url"],
            moondream["additional_files"][0]["url"],
        ]

        for url in expected_mirrored:
            self.assertIn(mirror, url, f"{url} must be served from the mirror")


class DownloadFileChecksumTest(TestCase):
    """sha256 verification is wired into the post-#1950 download flow."""

    def test_matching_checksum_is_accepted(self):
        payload = b"a" * 2048
        digest = hashlib.sha256(payload).hexdigest()
        response = _FakeResponse(
            chunks=[payload[:1024], payload[1024:]],
            headers={"content-length": str(len(payload))},
        )
        with tempfile.TemporaryDirectory() as temp_dir:
            target = Path(temp_dir) / "nested" / "model.onnx"
            with patch("api.ml_models.requests.get", return_value=response):
                _download_file("https://example.invalid/x", target, "model", digest)

            self.assertEqual(payload, target.read_bytes())
            self.assertEqual([target], list(target.parent.iterdir()))

    def test_mismatching_checksum_is_rejected_and_nothing_lands(self):
        payload = b"a" * 2048
        wrong_digest = hashlib.sha256(b"different").hexdigest()
        response = _FakeResponse(
            chunks=[payload],
            headers={"content-length": str(len(payload))},
        )
        with tempfile.TemporaryDirectory() as temp_dir:
            target = Path(temp_dir) / "nested" / "model.onnx"
            with patch("api.ml_models.requests.get", return_value=response):
                with self.assertRaises(ModelChecksumError):
                    _download_file(
                        "https://example.invalid/x", target, "model", wrong_digest
                    )

            # Neither the final file nor the partial ".part" sibling survives.
            self.assertFalse(target.exists())
            self.assertEqual([], list(target.parent.iterdir()))

    def test_no_pin_skips_verification(self):
        # A future hashless entry must not crash the download path.
        payload = b"unpinned payload"
        response = _FakeResponse(
            chunks=[payload],
            headers={"content-length": str(len(payload))},
        )
        with tempfile.TemporaryDirectory() as temp_dir:
            target = Path(temp_dir) / "model.bin"
            with patch("api.ml_models.requests.get", return_value=response):
                _download_file("https://example.invalid/x", target, "model", None)

            self.assertEqual(payload, target.read_bytes())


@override_config(OCR_MODEL="ppocrv6_small")
class DownloadModelChecksumTest(TestCase):
    def test_bad_checksum_leaves_no_archive_or_target(self):
        model = _ocr_model("small")
        with tempfile.TemporaryDirectory() as temp_dir:
            media_root = Path(temp_dir) / "protected_media"
            model_folder = media_root / "data_models"
            archive = model_folder / (model["target-dir"] + ".tar.gz")

            # A well-formed response whose bytes do not match the pinned hash:
            # the archive must be rejected before any unpack is attempted.
            body = b"not the real bundle"
            response = _FakeResponse(
                chunks=[body],
                headers={"content-length": str(len(body))},
            )

            with override_settings(MEDIA_ROOT=str(media_root)):
                with patch("api.ml_models.requests.get", return_value=response):
                    with self.assertRaises(ModelChecksumError):
                        download_model(model)

            self.assertFalse(archive.exists())
            self.assertFalse((model_folder / (archive.name + ".part")).exists())
            self.assertFalse(_model_target_exists(model_folder, model))


class MlModelSelectionTest(TestCase):
    def _selected_model_names(self):
        return [model["name"] for model in _iter_required_models()]

    def _create_required_models(self, model_root: Path):
        (model_root / "clip-embeddings").mkdir(parents=True)
        (model_root / "places365").mkdir(parents=True)
        (model_root / "resnet18-5c106cde.pth").write_bytes(b"model")
        selected_face_model = model_root / "face_recognition" / "models" / "buffalo_sc"
        selected_face_model.mkdir(parents=True)
        (selected_face_model / "w600k_mbf.onnx").write_bytes(b"model")

    @override_config(
        CAPTIONING_MODEL="moondream",
        LLM_MODEL="None",
        TAGGING_MODEL="places365",
        FACE_RECOGNITION_MODEL="buffalo_sc",
    )
    def test_moondream_selected_as_captioning_model(self):
        self.assertIn("moondream", self._selected_model_names())

    @override_config(
        CAPTIONING_MODEL="None",
        LLM_MODEL="moondream",
        TAGGING_MODEL="places365",
        FACE_RECOGNITION_MODEL="buffalo_sc",
    )
    def test_moondream_selected_as_llm_model(self):
        self.assertIn("moondream", self._selected_model_names())

    @override_config(
        CAPTIONING_MODEL="im2txt",
        LLM_MODEL="None",
        TAGGING_MODEL="places365",
        FACE_RECOGNITION_MODEL="buffalo_sc",
    )
    def test_moondream_not_selected_when_unused(self):
        self.assertNotIn("moondream", self._selected_model_names())

    @override_config(
        CAPTIONING_MODEL="moondream",
        LLM_MODEL="None",
        TAGGING_MODEL="places365",
        FACE_RECOGNITION_MODEL="buffalo_sc",
    )
    def test_do_all_models_exist_requires_moondream_for_captioning(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            media_root = Path(temp_dir) / "protected_media"
            model_root = media_root / "data_models"
            self._create_required_models(model_root)

            with override_settings(MEDIA_ROOT=str(media_root)):
                self.assertFalse(do_all_models_exist())

                (model_root / "moondream2-text-model-f16.gguf").write_bytes(b"model")
                (model_root / "moondream2-mmproj-f16.gguf").write_bytes(b"model")
                self.assertTrue(do_all_models_exist())
