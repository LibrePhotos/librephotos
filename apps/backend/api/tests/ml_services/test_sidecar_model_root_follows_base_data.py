"""The ML sidecars find their models under ``BASE_DATA``, not ``/``.

``api.ml_models`` downloads every model to ``MEDIA_ROOT/data_models``, which
is ``BASE_DATA/protected_media/data_models``. The sidecars never load Django,
so they cannot read ``settings.MEDIA_ROOT``; they used to hard-code the Docker
layout (``/protected_media/data_models``) instead, which on a native Windows
run with ``BASE_DATA=C:\...\lpdata`` resolved to ``C:\protected_media`` and
failed with ONNX ``NO_SUCHFILE`` (face_recognition even downloaded its model
there). ``api.services._service_environment`` now hands ``BASE_DATA`` to the
spawned services, and each service derives its model directory from it.

Each service module is executed afresh from its file under a controlled
environment, so the assertions cover the import-time constants the services
actually use, without reloading the registered module the other tests hold.
"""

import importlib.util
import os
import subprocess
import sys
import tempfile
import uuid
from unittest.mock import patch

from django.conf import settings
from django.test import SimpleTestCase, override_settings

from api.services import _service_environment

BACKEND_DIR = os.path.dirname(
    os.path.dirname(os.path.dirname(os.path.dirname(__file__)))
)
SERVICE_DIR = os.path.join(BACKEND_DIR, "service")

DOCKER_MODELS_ROOT = os.path.join(os.sep, "protected_media", "data_models")


def _load_fresh(relative_path, environ):
    """Execute a service module from its file with ``environ`` as os.environ.

    ``BASE_DATA`` is removed first, so passing an environment without it
    exercises the fallback rather than whatever the test runner inherited.
    """
    path = os.path.join(SERVICE_DIR, *relative_path.split("/"))
    name = f"sidecar_probe_{uuid.uuid4().hex}"
    with patch.dict(os.environ, environ, clear=False):
        os.environ.pop("BASE_DATA", None)
        os.environ.update(environ)
        spec = importlib.util.spec_from_file_location(name, path)
        module = importlib.util.module_from_spec(spec)
        sys.modules[name] = module
        try:
            spec.loader.exec_module(module)
        finally:
            sys.modules.pop(name, None)
    return module


class SidecarModelRootFollowsBaseDataTest(SimpleTestCase):
    base_data = os.path.join("C:\\", "lpdata") if os.name == "nt" else "/srv/lpdata"
    models_root = os.path.join(base_data, "protected_media", "data_models")

    def test_face_recognition_model_root(self):
        module = _load_fresh("face_recognition/main.py", {"BASE_DATA": self.base_data})
        self.assertEqual(
            module.FACE_MODEL_ROOT, os.path.join(self.models_root, "face_recognition")
        )

    def test_face_recognition_defaults_to_docker_layout(self):
        module = _load_fresh("face_recognition/main.py", {})
        self.assertEqual(
            module.FACE_MODEL_ROOT, os.path.join(DOCKER_MODELS_ROOT, "face_recognition")
        )

    def test_image_captioning_model_dir(self):
        module = _load_fresh(
            "image_captioning/lfm2_vl.py", {"BASE_DATA": self.base_data}
        )
        self.assertEqual(module.MODELS_ROOT, self.models_root)
        self.assertEqual(
            module.MODEL_DIR, os.path.join(self.models_root, module.MODEL_NAME)
        )
        # The captioner's default model_dir is the module constant.
        self.assertEqual(module.Lfm2VlCaptioner().model_dir, module.MODEL_DIR)

    def test_image_captioning_defaults_to_docker_layout(self):
        module = _load_fresh("image_captioning/lfm2_vl.py", {})
        self.assertEqual(module.MODELS_ROOT, DOCKER_MODELS_ROOT)

    def test_mobileclip_model_dir(self):
        module = _load_fresh(
            "tags/mobileclip/mobileclip.py", {"BASE_DATA": self.base_data}
        )
        expected = os.path.join(self.models_root, "mobileclip_s2")
        self.assertEqual(module.MOBILECLIP_MODEL_DIR, expected)
        self.assertEqual(
            module.MOBILECLIP_VISION_PATH, os.path.join(expected, "vision_model.onnx")
        )
        self.assertEqual(
            module.MOBILECLIP_EMBEDDINGS_CACHE,
            os.path.join(expected, "tag_embeddings.npy"),
        )

    def test_mobileclip_defaults_to_docker_layout(self):
        module = _load_fresh("tags/mobileclip/mobileclip.py", {})
        self.assertEqual(
            module.MOBILECLIP_MODEL_DIR,
            os.path.join(DOCKER_MODELS_ROOT, "mobileclip_s2"),
        )

    def test_siglip2_model_dir(self):
        module = _load_fresh("tags/siglip2/siglip2.py", {"BASE_DATA": self.base_data})
        expected = os.path.join(self.models_root, "siglip2")
        self.assertEqual(module.SIGLIP2_MODEL_DIR, expected)
        self.assertEqual(
            module.SIGLIP2_TEXT_PATH, os.path.join(expected, "text_model.onnx")
        )
        self.assertEqual(
            module.SIGLIP2_TOKENIZER_PATH, os.path.join(expected, "tokenizer.model")
        )

    def test_siglip2_defaults_to_docker_layout(self):
        module = _load_fresh("tags/siglip2/siglip2.py", {})
        self.assertEqual(
            module.SIGLIP2_MODEL_DIR, os.path.join(DOCKER_MODELS_ROOT, "siglip2")
        )

    def test_ocr_default_bundle_dir(self):
        module = _load_fresh("ocr/ppocr/config.py", {"BASE_DATA": self.base_data})
        self.assertEqual(
            module.DEFAULT_MODEL_DIR,
            os.path.join(self.models_root, "ocr", "ppocrv6_small"),
        )
        with patch.dict(os.environ, {}, clear=False):
            os.environ.pop("OCR_MODEL_DIR", None)
            self.assertEqual(module.resolve_model_dir(), module.DEFAULT_MODEL_DIR)

    def test_ocr_explicit_model_dir_still_wins(self):
        module = _load_fresh("ocr/ppocr/config.py", {"BASE_DATA": self.base_data})
        with patch.dict(os.environ, {"OCR_MODEL_DIR": "/bundles/large"}):
            self.assertEqual(module.resolve_model_dir(), "/bundles/large")
        self.assertEqual(module.resolve_model_dir("/explicit"), "/explicit")

    def test_ocr_defaults_to_docker_layout(self):
        module = _load_fresh("ocr/ppocr/config.py", {})
        self.assertEqual(
            module.DEFAULT_MODEL_DIR,
            os.path.join(DOCKER_MODELS_ROOT, "ocr", "ppocrv6_small"),
        )

    def test_thumbnail_media_root(self):
        # Where the RAW thumbnail sidecar is allowed to write.
        module = _load_fresh("thumbnail/main.py", {"BASE_DATA": self.base_data})
        self.assertEqual(
            module.MEDIA_ROOT, os.path.join(self.base_data, "protected_media")
        )

    def test_thumbnail_defaults_to_docker_layout(self):
        module = _load_fresh("thumbnail/main.py", {})
        self.assertEqual(module.MEDIA_ROOT, os.path.join(os.sep, "protected_media"))


class ServiceEnvironmentPassesBaseDataTest(SimpleTestCase):
    def test_base_data_comes_from_settings_not_the_ambient_environment(self):
        with (
            override_settings(BASE_DATA="/configured/root"),
            patch.dict(os.environ, {"BASE_DATA": "/ambient/root"}),
        ):
            env = _service_environment()
        self.assertEqual(env["BASE_DATA"], "/configured/root")
        self.assertEqual(env["BASE_LOGS"], settings.LOGS_ROOT)

    def test_docker_default_is_the_filesystem_root(self):
        """Docker leaves BASE_DATA unset, so the services see "/" as before."""
        with override_settings(BASE_DATA="/"):
            env = _service_environment()
        self.assertEqual(env["BASE_DATA"], "/")


class ServiceEnvironmentPythonPathTest(SimpleTestCase):
    """The sidecars import service.onnx_session although they run as scripts.

    ``python service/<name>/main.py`` puts only the script's own directory on
    sys.path, so the backend root has to come in through PYTHONPATH.
    """

    def test_the_backend_root_comes_first(self):
        with patch.dict(os.environ, {"PYTHONPATH": "/somewhere/else"}):
            env = _service_environment()
        self.assertEqual(
            env["PYTHONPATH"].split(os.pathsep), [BACKEND_DIR, "/somewhere/else"]
        )

    def test_without_an_ambient_pythonpath(self):
        with patch.dict(os.environ):
            os.environ.pop("PYTHONPATH", None)
            env = _service_environment()
        self.assertEqual(env["PYTHONPATH"], BACKEND_DIR)

    def test_a_script_context_can_import_the_shared_helper(self):
        # -c from another directory: like a script, the backend root is not on
        # sys.path unless the environment puts it there.
        with tempfile.TemporaryDirectory() as elsewhere:
            result = subprocess.run(
                [sys.executable, "-c", "import service.onnx_session"],
                cwd=elsewhere,
                env=_service_environment(),
                capture_output=True,
                text=True,
            )
        self.assertEqual(result.returncode, 0, result.stderr)
