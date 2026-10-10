"""Tests for ``service/tags/main.py``: tags, image and query embeddings.

``service/tags/main.py`` is a standalone Flask microservice. It is never
imported by the Django app, and its top-level import (``from openclip.openclip
import ...``) only resolves when ``service/tags`` itself is on ``sys.path``. So
the module is loaded here by file path with that package stubbed into
``sys.modules``. Flask and gevent are the real packages; no model, no network,
no ML.

Behaviour pinned here:

Request parsing (the ``400`` branch)
  * ``image_path`` is required; a missing key, a non-object body or a
    request without a JSON content type yields an **empty body with 400**.
  * ``tagging_model`` defaults to OpenCLIP (also when sent as ``null``); any
    other model name is a 400 with an error, and no model is built.
    ``confidence`` is accepted for compatibility and ignored.
  * ``last_request_time`` is stamped *before* parsing, so even a 400 updates it.

Tagging
  * ``OpenCLIP().predict(path, threshold=MIN_PROBABILITY, max_tags=10,
    with_embedding=...)``; the model is built once and kept; a model that
    raises is dropped so the next request builds it again; a missing file is a
    400 that keeps the loaded model.

Embeddings
  * ``/clip-embeddings`` keeps a slot per path (``null`` for an unreadable
    one) and, with ``with_tags``, adds the tags of the same run.
  * ``/query-embeddings`` returns the raw text embedding and its norm.
"""

import importlib.util
import os
import sys
import types
from unittest.mock import MagicMock, patch

import numpy as np
from django.test import SimpleTestCase

MAIN_PATH = os.path.join(
    os.path.dirname(
        os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    ),
    "service",
    "tags",
    "main.py",
)

MODEL_NAME = "openclip_vitb32"
_STUB_NAMES = ("openclip", "openclip.openclip")


def _install_stub_package():
    pkg = types.ModuleType("openclip")
    pkg.__path__ = []
    sub = types.ModuleType("openclip.openclip")
    sub.OpenCLIP = MagicMock(name="OpenCLIP")
    sub.MODEL_NAME = MODEL_NAME
    sub.DEFAULT_MIN_PROBABILITY = 0.0075
    sub.DEFAULT_MAX_TAGS = 10
    pkg.openclip = sub
    sys.modules["openclip"] = pkg
    sys.modules["openclip.openclip"] = sub


def _load_tags_main():
    # The stub exists only so main.py's top-level import resolves; leaving it
    # in sys.modules would shadow the real package for later test modules, so
    # restore the previous entries once the module is loaded.
    saved = {name: sys.modules.get(name) for name in _STUB_NAMES}
    _install_stub_package()
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


class TagsServiceTestCase(SimpleTestCase):
    def setUp(self):
        tags_main.app.config["TESTING"] = False
        self.client = tags_main.app.test_client()
        tags_main.tagger_instances.clear()
        tags_main.app.extensions["librephotos_sidecar"].last_request_time = None
        self.model_cls = MagicMock(name="OpenCLIP")
        patcher = patch.object(tags_main, "OpenCLIP", self.model_cls)
        patcher.start()
        self.addCleanup(patcher.stop)
        exists = patch.object(tags_main, "image_exists", return_value=True)
        self.image_exists = exists.start()
        self.addCleanup(exists.stop)
        self.model = self.model_cls.return_value

    def _post(self, **body):
        return self.client.post("/generate-tags", json=body)

    # ------------------------------------------------------------- tagging
    def test_tags_come_from_openclip_at_its_cut_off(self):
        self.model.predict.return_value = {"tags": ["beach", "ocean"]}

        response = self._post(image_path="/a/b.jpg")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.get_json(), {"tags": {"tags": ["beach", "ocean"]}})
        self.model.predict.assert_called_once_with(
            "/a/b.jpg",
            threshold=tags_main.MIN_PROBABILITY,
            max_tags=10,
            with_embedding=False,
        )

    def test_null_or_own_model_name_is_accepted(self):
        self.model.predict.return_value = {"tags": []}
        for name in (None, MODEL_NAME):
            with self.subTest(tagging_model=name):
                response = self._post(image_path="/a/b.jpg", tagging_model=name)
                self.assertEqual(response.status_code, 200)

    def test_other_model_names_are_a_400_without_building_anything(self):
        for name in ("places365", "a-retired-tagger"):
            with self.subTest(tagging_model=name):
                response = self._post(image_path="/a/b.jpg", tagging_model=name)
                self.assertEqual(response.status_code, 400)
                self.assertIn(name, response.get_json()["error"])
        self.model_cls.assert_not_called()

    def test_the_model_is_built_once(self):
        self.model.predict.return_value = {"tags": []}

        self._post(image_path="/1.jpg")
        self._post(image_path="/2.jpg")

        self.assertEqual(self.model_cls.call_count, 1)
        self.assertEqual(set(tags_main.tagger_instances), {MODEL_NAME})

    def test_with_embedding_reaches_the_model(self):
        self.model.predict.return_value = {"tags": [], "embedding": [1.0]}

        response = self._post(image_path="/a.jpg", with_embedding=True)

        self.assertEqual(response.get_json()["tags"]["embedding"], [1.0])
        self.model.predict.assert_called_once_with(
            "/a.jpg",
            threshold=tags_main.MIN_PROBABILITY,
            max_tags=10,
            with_embedding=True,
        )

    # ---------------------------------------------------------- embeddings
    def test_image_embeddings_keep_a_slot_per_path(self):
        self.model.embed_images_raw.return_value = [
            np.array([3.0, 4.0], dtype=np.float32),
            None,
        ]
        response = self.client.post(
            "/clip-embeddings", json={"imgs": ["/a.jpg", "/bad.jpg"]}
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            response.get_json(),
            {"imgs_emb": [[3.0, 4.0], None], "magnitudes": [5.0, None]},
        )
        self.model.embed_images_raw.assert_called_once_with(["/a.jpg", "/bad.jpg"])
        self.model.tags_for.assert_not_called()

    def test_image_embeddings_with_the_tags_of_the_same_run(self):
        first = np.array([3.0, 4.0], dtype=np.float32)
        self.model.embed_images_raw.return_value = [first, None]
        self.model.tags_for.return_value = ["cat"]

        response = self.client.post(
            "/clip-embeddings",
            json={"imgs": ["/a.jpg", "/bad.jpg"], "with_tags": True},
        )

        self.assertEqual(response.get_json()["tags"], [["cat"], None])
        ((embedding,), kwargs) = self.model.tags_for.call_args
        self.assertIs(embedding, first)
        self.assertEqual(
            kwargs, {"threshold": tags_main.MIN_PROBABILITY, "max_tags": 10}
        )

    def test_query_embeddings(self):
        self.model.embed_text_raw.return_value = np.array([0.0, 2.0], np.float32)
        response = self.client.post("/query-embeddings", json={"query": "a dog"})

        self.assertEqual(response.get_json(), {"emb": [0.0, 2.0], "magnitude": 2.0})
        self.model.embed_text_raw.assert_called_once_with("a dog")

    # -------------------------------------------------------------- errors
    def test_missing_file_is_a_400_that_keeps_the_loaded_model(self):
        self.model.predict.return_value = {"tags": []}
        self._post(image_path="/a/b.jpg")
        self.image_exists.return_value = False

        response = self._post(image_path="/gone.jpg")

        self.assertEqual(response.status_code, 400)
        self.assertIn(MODEL_NAME, tags_main.tagger_instances)
        self.assertEqual(self.model_cls.call_count, 1)

    def test_model_exception_is_a_500_and_evicts_the_instance(self):
        self.model.predict.side_effect = RuntimeError("boom")

        response = self._post(image_path="/a/b.jpg")

        self.assertEqual(response.status_code, 500)
        self.assertEqual(response.get_json(), {"error": "Failed to process image"})
        self.assertNotIn(MODEL_NAME, tags_main.tagger_instances)

        # The next request builds a fresh model.
        self.model.predict.side_effect = None
        self.model.predict.return_value = {"tags": ["ok"]}
        self.assertEqual(self._post(image_path="/a/b.jpg").status_code, 200)
        self.assertEqual(self.model_cls.call_count, 2)

    def test_missing_image_path_is_an_empty_400(self):
        response = self._post(tagging_model=MODEL_NAME)
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

    def test_unload_drops_the_model(self):
        self.model.predict.return_value = {"tags": []}
        self._post(image_path="/a.jpg")
        self.assertTrue(self.client.get("/health").get_json()["model_loaded"])

        self.assertEqual(self.client.post("/unload-model").status_code, 200)

        self.assertFalse(self.client.get("/health").get_json()["model_loaded"])
