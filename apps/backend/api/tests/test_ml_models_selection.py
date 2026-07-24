import tempfile
from pathlib import Path

from constance.test import override_config
from django.test import TestCase, override_settings

from api.ml_models import _iter_required_models, do_all_models_exist


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
