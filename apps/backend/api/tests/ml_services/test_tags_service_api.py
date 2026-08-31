"""Characterization tests for ``service/tags/main.py::generate_tags``.

``service/tags/main.py`` is a standalone Flask microservice. It is never
imported by the Django app, and its top-level imports (``from
places365.places365 import Places365`` / ``from siglip2.siglip2 import
SigLIP2``) only resolve when ``service/tags`` itself is on ``sys.path`` *and*
torch / onnxruntime / sentencepiece are importable. So the module is loaded
here by file path with ``places365``/``siglip2`` stubbed into ``sys.modules``.
Flask and gevent are the real packages; no model, no network, no ML.

Behaviour pinned here (current, not aspirational):

Request parsing (the ``400`` branch)
  * ``image_path`` is read with ``data["image_path"]`` -- required; a missing
    key raises ``KeyError`` and yields an **empty body with status 400**.
  * A body that is not a JSON object (a list, a bare string) also yields 400,
    because ``data["image_path"]`` raises ``TypeError``.
  * A request without a JSON content type yields 400 too (Flask's
    ``get_json()`` aborts, and the resulting ``HTTPException`` is swallowed by
    the bare ``except Exception``).
  * ``confidence`` defaults to ``0.4`` and ``tagging_model`` to ``"places365"``.
  * ``last_request_time`` is stamped *before* parsing, so even a 400 updates it.

Dispatch
  * ``tagging_model == "siglip2"`` -> ``SigLIP2().predict(image_path,
    threshold=0.05, max_tags=10)``. The ``confidence`` field is **ignored**
    on this path (QUIRK, pinned).
  * Anything else -- ``"places365"``, an unknown string, ``None`` -- falls
    through to ``Places365().inference_places365(image_path, confidence)``
    (confidence passed positionally).
  * Both model instances are lazily constructed once and cached in module
    globals; a second request reuses the same object. A constructor raising
    leaves the global as ``None`` (so the next request retries) and returns 500.

Responses
  * Success -> ``{"tags": <whatever the model returned>}`` with status **201**
    (not 200). The model's return value is passed through untouched -- lists,
    empty lists, dicts and non-JSON-serialisable values are not validated
    (a non-serialisable value escapes as a 500 from Flask's own encoder).
  * Any exception from the model -> ``{"error": "Failed to process image"}``
    with status **500**; the real exception text is only printed.
  * ``/health`` returns ``{"last_request_time": <float or None>}`` with 200.
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
    ("places365", "places365.places365", "Places365"),
    ("siglip2", "siglip2.siglip2", "SigLIP2"),
)


def _install_stub_packages():
    """Stub the two heavy model packages so ``main.py`` can be imported."""
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
    # in sys.modules would shadow the real packages for later test modules
    # (test_places365_inference imports the real places365), so restore the previous
    # entries once the module is loaded.
    saved = {}
    for pkg_name, mod_name, _ in _STUB_NAMES:
        for name in (pkg_name, mod_name):
            saved[name] = sys.modules.get(name)
    _install_stub_packages()
    try:
        spec = importlib.util.spec_from_file_location(
            "service_tags_main_u50", MAIN_PATH
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
    """Characterization tests for the ``/generate-tags`` view."""

    def setUp(self):
        tags_main.app.config["TESTING"] = False
        self.client = tags_main.app.test_client()
        # Reset the cached singletons + the health timestamp between tests.
        tags_main.places365_instance = None
        tags_main.siglip2_instance = None
        tags_main.last_request_time = None
        self.places_cls = MagicMock(name="Places365")
        self.siglip_cls = MagicMock(name="SigLIP2")
        tags_main.Places365 = self.places_cls
        tags_main.SigLIP2 = self.siglip_cls

    # ------------------------------------------------------------------
    # happy path: places365 (the default)
    # ------------------------------------------------------------------
    def test_places365_default_model_and_confidence(self):
        instance = self.places_cls.return_value
        instance.inference_places365.return_value = ["beach", "ocean"]

        response = self.client.post("/generate-tags", json={"image_path": "/a/b.jpg"})

        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.get_json(), {"tags": ["beach", "ocean"]})
        # default confidence 0.4, passed positionally
        instance.inference_places365.assert_called_once_with("/a/b.jpg", 0.4)
        self.siglip_cls.assert_not_called()

    def test_places365_explicit_confidence_is_forwarded(self):
        instance = self.places_cls.return_value
        instance.inference_places365.return_value = []

        response = self.client.post(
            "/generate-tags",
            json={
                "image_path": "/a/b.jpg",
                "confidence": 0.9,
                "tagging_model": "places365",
            },
        )

        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.get_json(), {"tags": []})
        instance.inference_places365.assert_called_once_with("/a/b.jpg", 0.9)

    def test_unknown_tagging_model_falls_back_to_places365(self):
        instance = self.places_cls.return_value
        instance.inference_places365.return_value = ["x"]

        for model in ("not-a-model", "", "SigLIP2", None):
            with self.subTest(model=model):
                instance.inference_places365.reset_mock()
                response = self.client.post(
                    "/generate-tags",
                    json={"image_path": "/a/b.jpg", "tagging_model": model},
                )
                self.assertEqual(response.status_code, 201)
                self.assertEqual(response.get_json(), {"tags": ["x"]})
                instance.inference_places365.assert_called_once_with("/a/b.jpg", 0.4)
        self.siglip_cls.assert_not_called()

    def test_places365_instance_is_constructed_once_and_cached(self):
        self.places_cls.return_value.inference_places365.return_value = []

        self.client.post("/generate-tags", json={"image_path": "/1.jpg"})
        self.client.post("/generate-tags", json={"image_path": "/2.jpg"})

        self.assertEqual(self.places_cls.call_count, 1)
        self.assertIs(tags_main.places365_instance, self.places_cls.return_value)

    # ------------------------------------------------------------------
    # happy path: siglip2
    # ------------------------------------------------------------------
    def test_siglip2_uses_fixed_threshold_and_max_tags(self):
        instance = self.siglip_cls.return_value
        instance.predict.return_value = ["cat"]

        response = self.client.post(
            "/generate-tags",
            json={
                "image_path": "/a/b.jpg",
                "tagging_model": "siglip2",
                # QUIRK: confidence is silently ignored on the siglip2 branch.
                "confidence": 0.99,
            },
        )

        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.get_json(), {"tags": ["cat"]})
        instance.predict.assert_called_once_with(
            "/a/b.jpg", threshold=0.05, max_tags=10
        )
        self.places_cls.assert_not_called()

    def test_siglip2_instance_is_constructed_once_and_cached(self):
        self.siglip_cls.return_value.predict.return_value = []

        self.client.post(
            "/generate-tags", json={"image_path": "/1.jpg", "tagging_model": "siglip2"}
        )
        self.client.post(
            "/generate-tags", json={"image_path": "/2.jpg", "tagging_model": "siglip2"}
        )

        self.assertEqual(self.siglip_cls.call_count, 1)
        self.assertIs(tags_main.siglip2_instance, self.siglip_cls.return_value)

    def test_models_are_cached_independently(self):
        self.places_cls.return_value.inference_places365.return_value = ["p"]
        self.siglip_cls.return_value.predict.return_value = ["s"]

        self.client.post("/generate-tags", json={"image_path": "/1.jpg"})
        self.assertIsNotNone(tags_main.places365_instance)
        self.assertIsNone(tags_main.siglip2_instance)

        self.client.post(
            "/generate-tags", json={"image_path": "/2.jpg", "tagging_model": "siglip2"}
        )
        self.assertIsNotNone(tags_main.places365_instance)
        self.assertIsNotNone(tags_main.siglip2_instance)

    def test_result_is_passed_through_untouched(self):
        instance = self.places_cls.return_value
        instance.inference_places365.return_value = {"scene": ["a"], "attr": []}

        response = self.client.post("/generate-tags", json={"image_path": "/a.jpg"})

        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.get_json(), {"tags": {"scene": ["a"], "attr": []}})

    # ------------------------------------------------------------------
    # 400 branch: bad request payloads
    # ------------------------------------------------------------------
    def test_missing_image_path_returns_empty_400(self):
        response = self.client.post("/generate-tags", json={"confidence": 0.5})

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.get_data(as_text=True), "")
        self.places_cls.assert_not_called()
        self.siglip_cls.assert_not_called()

    def test_non_object_json_bodies_return_400(self):
        for payload in ([], ["/a.jpg"], "just-a-string", 5):
            with self.subTest(payload=payload):
                response = self.client.post("/generate-tags", json=payload)
                self.assertEqual(response.status_code, 400)
                self.assertEqual(response.get_data(as_text=True), "")

    def test_missing_json_content_type_returns_400(self):
        response = self.client.post("/generate-tags", data="not json")

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.get_data(as_text=True), "")

    def test_malformed_json_body_returns_400(self):
        response = self.client.post(
            "/generate-tags",
            data="{not valid json",
            content_type="application/json",
        )

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.get_data(as_text=True), "")

    def test_null_json_body_returns_400(self):
        response = self.client.post("/generate-tags", json=None)

        self.assertEqual(response.status_code, 400)

    # ------------------------------------------------------------------
    # 500 branch: model failures
    # ------------------------------------------------------------------
    def test_places365_inference_error_returns_500(self):
        instance = self.places_cls.return_value
        instance.inference_places365.side_effect = RuntimeError("boom")

        response = self.client.post("/generate-tags", json={"image_path": "/a.jpg"})

        self.assertEqual(response.status_code, 500)
        # the real error message is only printed, never leaked to the client
        self.assertEqual(response.get_json(), {"error": "Failed to process image"})

    def test_siglip2_predict_error_returns_500(self):
        instance = self.siglip_cls.return_value
        instance.predict.side_effect = ValueError("bad image")

        response = self.client.post(
            "/generate-tags",
            json={"image_path": "/a.jpg", "tagging_model": "siglip2"},
        )

        self.assertEqual(response.status_code, 500)
        self.assertEqual(response.get_json(), {"error": "Failed to process image"})

    def test_model_construction_error_returns_500_and_leaves_global_none(self):
        self.places_cls.side_effect = OSError("model file missing")

        response = self.client.post("/generate-tags", json={"image_path": "/a.jpg"})

        self.assertEqual(response.status_code, 500)
        self.assertEqual(response.get_json(), {"error": "Failed to process image"})
        self.assertIsNone(tags_main.places365_instance)

        # a later successful construction still works (the failure is not sticky)
        self.places_cls.side_effect = None
        self.places_cls.return_value.inference_places365.return_value = ["ok"]
        retry = self.client.post("/generate-tags", json={"image_path": "/a.jpg"})
        self.assertEqual(retry.status_code, 201)
        self.assertEqual(retry.get_json(), {"tags": ["ok"]})

    def test_siglip2_construction_error_returns_500_and_leaves_global_none(self):
        self.siglip_cls.side_effect = OSError("onnx missing")

        response = self.client.post(
            "/generate-tags",
            json={"image_path": "/a.jpg", "tagging_model": "siglip2"},
        )

        self.assertEqual(response.status_code, 500)
        self.assertIsNone(tags_main.siglip2_instance)

    # ------------------------------------------------------------------
    # last_request_time / health
    # ------------------------------------------------------------------
    def test_health_reports_none_before_any_request(self):
        response = self.client.get("/health")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.get_json(), {"last_request_time": None})

    def test_successful_request_stamps_last_request_time(self):
        self.places_cls.return_value.inference_places365.return_value = []

        self.client.post("/generate-tags", json={"image_path": "/a.jpg"})

        stamped = tags_main.last_request_time
        self.assertIsNotNone(stamped)
        self.assertEqual(
            self.client.get("/health").get_json(), {"last_request_time": stamped}
        )

    def test_bad_request_also_stamps_last_request_time(self):
        # the timestamp is written before parsing, so even a 400 counts as
        # activity for the health check.
        self.client.post("/generate-tags", json={})

        self.assertIsNotNone(tags_main.last_request_time)

    def test_failed_inference_also_stamps_last_request_time(self):
        self.places_cls.return_value.inference_places365.side_effect = Exception("x")

        self.client.post("/generate-tags", json={"image_path": "/a.jpg"})

        self.assertIsNotNone(tags_main.last_request_time)

    def test_health_only_accepts_get(self):
        self.assertEqual(self.client.post("/health").status_code, 405)

    def test_generate_tags_only_accepts_post(self):
        self.assertEqual(self.client.get("/generate-tags").status_code, 405)


class TagsMainModuleTestCase(SimpleTestCase):
    """Module-level surface that a refactor must preserve."""

    def test_log_prefixes_messages(self):
        from io import StringIO
        from unittest.mock import patch

        buffer = StringIO()
        with patch("sys.stdout", buffer):
            tags_main.log("hello")

        self.assertEqual(buffer.getvalue(), "tags: hello\n")

    def test_routes_are_registered(self):
        rules = {
            r.rule: sorted(r.methods & {"GET", "POST"})
            for r in tags_main.app.url_map.iter_rules()
        }
        self.assertEqual(rules.get("/generate-tags"), ["POST"])
        self.assertEqual(rules.get("/health"), ["GET"])
