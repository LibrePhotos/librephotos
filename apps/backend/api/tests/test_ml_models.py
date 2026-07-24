import tempfile
from pathlib import Path

from constance.test import override_config
from django.test import TestCase, override_settings

from api.ml_models import (
    ML_MODELS,
    MlTypes,
    _is_model_selected,
    _model_target_exists,
    do_all_models_exist,
)


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
