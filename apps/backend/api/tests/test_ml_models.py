import tempfile
from pathlib import Path

from constance.test import override_config
from django.test import TestCase, override_settings

from api.ml_models import do_all_models_exist


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
            selected_face_model = model_root / "face_recognition" / "models" / "buffalo_sc"
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
