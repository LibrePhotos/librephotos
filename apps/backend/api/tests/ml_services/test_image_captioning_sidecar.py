"""Tests for the ``/generate-caption`` route of the image captioning sidecar.

The captioner is replaced by a fake. What is pinned is the shape of the two
replies the backend client relies on: ``{"caption": ...}`` with 200, and on
failure a 500 whose ``error`` carries the exception's type and message so the
backend can log why the caption failed, and a failed captioner is dropped so
the next request loads a fresh one.
"""

import importlib.util
import os
import sys
from unittest.mock import MagicMock, patch

from django.test import SimpleTestCase

from service.image_captioning import lfm2_vl

MAIN_PATH = os.path.join(
    os.path.dirname(
        os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    ),
    "service",
    "image_captioning",
    "main.py",
)


def _load_sidecar_main():
    # main.py runs with service/image_captioning as its working directory and
    # imports the captioner as the bare ``lfm2_vl``; alias the real module
    # under that name only while main.py is being loaded.
    previous = sys.modules.get("lfm2_vl")
    sys.modules["lfm2_vl"] = lfm2_vl
    try:
        spec = importlib.util.spec_from_file_location(
            "service_image_captioning_main_test", MAIN_PATH
        )
        module = importlib.util.module_from_spec(spec)
        sys.modules[spec.name] = module
        spec.loader.exec_module(module)
        return module
    finally:
        if previous is None:
            sys.modules.pop("lfm2_vl", None)
        else:
            sys.modules["lfm2_vl"] = previous


sidecar = _load_sidecar_main()


class GenerateCaptionRouteTest(SimpleTestCase):
    def setUp(self):
        sidecar.captioner = None
        self.client = sidecar.app.test_client()

    def tearDown(self):
        sidecar.captioner = None

    def test_caption_is_returned_with_200(self):
        fake = MagicMock()
        fake.caption.return_value = "a dog on a beach"
        with patch.object(sidecar, "Lfm2VlCaptioner", return_value=fake):
            response = self.client.post(
                "/generate-caption",
                json={"image_path": "/data/img.jpg", "prompt": "Describe it."},
            )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.get_json(), {"caption": "a dog on a beach"})
        fake.caption.assert_called_once_with("/data/img.jpg", "Describe it.")

    def test_failure_reports_the_exception_and_drops_the_captioner(self):
        fake = MagicMock()
        fake.caption.side_effect = FileNotFoundError("vision_encoder_q4f16.onnx")
        with patch.object(sidecar, "Lfm2VlCaptioner", return_value=fake):
            response = self.client.post(
                "/generate-caption", json={"image_path": "/data/img.jpg"}
            )

        self.assertEqual(response.status_code, 500)
        self.assertEqual(
            response.get_json(),
            {"error": "FileNotFoundError: vision_encoder_q4f16.onnx"},
        )
        self.assertIsNone(sidecar.captioner)

    def test_missing_image_path_is_a_400(self):
        response = self.client.post("/generate-caption", json={"prompt": "x"})

        self.assertEqual(response.status_code, 400)

    def test_unload_model_drops_the_captioner(self):
        loaded = MagicMock()
        sidecar.captioner = loaded

        with patch.object(sidecar, "Lfm2VlCaptioner"):
            self.assertIs(self.client.get("/health").get_json()["model_loaded"], True)
            response = self.client.get("/unload-model")

        self.assertEqual(response.status_code, 200)
        loaded.unload.assert_called_once_with()
        self.assertIsNone(sidecar.captioner)
        self.assertIs(self.client.get("/health").get_json()["model_loaded"], False)
