"""Tests for ``service/tags/main.py::generate_tags``.

``service/tags/main.py`` is a standalone Flask microservice. It is never
imported by the Django app, and its top-level imports (``from
mobileclip.mobileclip import MobileCLIP`` / ``from siglip2.siglip2 import
SigLIP2``) only resolve when ``service/tags`` itself is on ``sys.path`` *and*
onnxruntime / tokenizers / sentencepiece are importable. So the module is
loaded here by file path with both tagger packages stubbed into
``sys.modules``. Flask and gevent are the real packages; no model, no
network, no ML.

Behaviour pinned here:

Request parsing (the ``400`` branch)
  * ``image_path`` is required; a missing key, a non-object body or a
    request without a JSON content type yields an **empty body with 400**.
  * ``tagging_model`` defaults to ``"mobileclip_s2"`` (also when sent as
    ``null``); ``confidence`` is accepted for compatibility and ignored.
  * ``last_request_time`` is stamped *before* parsing, so even a 400 updates it.

Dispatch
  * ``"siglip2"`` -> ``SigLIP2().predict(path, threshold=0.05, max_tags=10)``.
  * ``"mobileclip_s2"`` -> ``MobileCLIP().predict(path, threshold=0.02, max_tags=10)``.
  * Any other model name -> ``{"error": ...}`` with 400, no tagger built.
  * Taggers are built once and cached per model; a tagger that raises is
    dropped from the cache so the next request retries from scratch.

Responses
  * Success -> ``{"tags": <the tagger's return value>}`` with status **200**.
  * Any exception from the tagger -> ``{"error": "Failed to process image"}``
    with status **500**.
  * ``/health`` (service._common) reports ``last_request_time`` (float or None).
"""

import importlib.util
import os
import sys
import types
from unittest.mock import MagicMock

from django.test import SimpleTestCase

MAIN_PATH = os.path.join(
    os.path.dirname(
        os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    ),
    "service",
    "tags",
    "main.py",
)


_STUB_NAMES = (
    ("mobileclip", "mobileclip.mobileclip", "MobileCLIP"),
    ("siglip2", "siglip2.siglip2", "SigLIP2"),
)


def _install_stub_packages():
    for pkg_name, mod_name, attr in _STUB_NAMES:
        pkg = types.ModuleType(pkg_name)
        pkg.__path__ = []
        sub = types.ModuleType(mod_name)
        setattr(sub, attr, MagicMock(name=attr))
        setattr(pkg, pkg_name, sub)
        sys.modules[pkg_name] = pkg
        sys.modules[mod_name] = sub


def _load_tags_main():
    # The stubs exist only so main.py's top-level imports resolve; leaving them
    # in sys.modules would shadow the real packages for later test modules, so
    # restore the previous entries once the module is loaded.
    saved = {}
    for pkg_name, mod_name, _ in _STUB_NAMES:
        for name in (pkg_name, mod_name):
            saved[name] = sys.modules.get(name)
    _install_stub_packages()
    try:
        spec = importlib.util.spec_from_file_location(
            "service_tags_main_test", MAIN_PATH
        )
        module = importlib.util.module_from_spec(spec)
        sys.modules[spec.name] = module
        spec.loader.exec_module(module)
        return module
    finally:
        for name, old in saved.items():
            if old is None:
                sys.modules.pop(name, None)
            else:
                sys.modules[name] = old


tags_main = _load_tags_main()


class GenerateTagsTestCase(SimpleTestCase):
    def setUp(self):
        tags_main.app.config["TESTING"] = False
        self.client = tags_main.app.test_client()
        tags_main.tagger_instances.clear()
        tags_main.app.extensions["librephotos_sidecar"].last_request_time = None
        self.mobileclip_cls = MagicMock(name="MobileCLIP")
        self.siglip_cls = MagicMock(name="SigLIP2")
        tags_main.TAGGERS = {
            "siglip2": (self.siglip_cls, 0.05),
            "mobileclip_s2": (self.mobileclip_cls, 0.02),
        }

    def _post(self, **body):
        return self.client.post("/generate-tags", json=body)

    # ------------------------------------------------------------ dispatch
    def test_mobileclip_is_the_default_model(self):
        instance = self.mobileclip_cls.return_value
        instance.predict.return_value = {"tags": ["beach", "ocean"]}

        response = self._post(image_path="/a/b.jpg")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.get_json(), {"tags": {"tags": ["beach", "ocean"]}})
        instance.predict.assert_called_once_with(
            "/a/b.jpg", threshold=0.02, max_tags=10
        )
        self.siglip_cls.assert_not_called()

    def test_null_tagging_model_falls_back_to_the_default(self):
        self.mobileclip_cls.return_value.predict.return_value = {"tags": []}
        response = self._post(image_path="/a/b.jpg", tagging_model=None)
        self.assertEqual(response.status_code, 200)
        self.mobileclip_cls.assert_called_once()

    def test_siglip2_dispatch_and_threshold(self):
        instance = self.siglip_cls.return_value
        instance.predict.return_value = {"tags": ["cat"]}

        response = self._post(
            image_path="/a/b.jpg", tagging_model="siglip2", confidence=0.9
        )

        self.assertEqual(response.status_code, 200)
        instance.predict.assert_called_once_with(
            "/a/b.jpg", threshold=0.05, max_tags=10
        )
        self.mobileclip_cls.assert_not_called()

    def test_unknown_model_is_a_400_without_building_anything(self):
        response = self._post(image_path="/a/b.jpg", tagging_model="places365")

        self.assertEqual(response.status_code, 400)
        self.assertIn("places365", response.get_json()["error"])
        self.mobileclip_cls.assert_not_called()
        self.siglip_cls.assert_not_called()

    def test_taggers_are_cached_per_model(self):
        self.mobileclip_cls.return_value.predict.return_value = {"tags": []}
        self.siglip_cls.return_value.predict.return_value = {"tags": []}

        self._post(image_path="/1.jpg")
        self._post(image_path="/2.jpg")
        self._post(image_path="/3.jpg", tagging_model="siglip2")

        self.assertEqual(self.mobileclip_cls.call_count, 1)
        self.assertEqual(self.siglip_cls.call_count, 1)
        self.assertEqual(set(tags_main.tagger_instances), {"mobileclip_s2", "siglip2"})

    # -------------------------------------------------------------- errors
    def test_tagger_exception_is_a_500_and_evicts_the_instance(self):
        self.mobileclip_cls.return_value.predict.side_effect = RuntimeError("boom")

        response = self._post(image_path="/a/b.jpg")

        self.assertEqual(response.status_code, 500)
        self.assertEqual(response.get_json(), {"error": "Failed to process image"})
        self.assertNotIn("mobileclip_s2", tags_main.tagger_instances)

        # The next request builds a fresh tagger.
        self.mobileclip_cls.return_value.predict.side_effect = None
        self.mobileclip_cls.return_value.predict.return_value = {"tags": ["ok"]}
        self.assertEqual(self._post(image_path="/a/b.jpg").status_code, 200)
        self.assertEqual(self.mobileclip_cls.call_count, 2)

    def test_missing_image_path_is_an_empty_400(self):
        response = self._post(tagging_model="siglip2")
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.data, b"")

    def test_non_object_body_is_an_empty_400(self):
        response = self.client.post("/generate-tags", json=["/a/b.jpg"])
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.data, b"")

    def test_non_json_request_is_an_empty_400(self):
        response = self.client.post("/generate-tags", data="image_path=/a/b.jpg")
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.data, b"")

    # -------------------------------------------------------------- health
    def test_health_reports_last_request_time_even_after_a_400(self):
        self.assertIsNone(self.client.get("/health").get_json()["last_request_time"])
        self._post()
        stamped = self.client.get("/health").get_json()["last_request_time"]
        self.assertIsInstance(stamped, float)
