"""Tests for ``service/tags/main.py``: tags, image and query embeddings.

``service/tags/main.py`` is a standalone Flask microservice. It is never
imported by the Django app, and its top-level import (``from openclip.openclip
import ...``) only resolves when ``service/tags`` itself is on ``sys.path``. So
the module is loaded here by file path with that package stubbed into
``sys.modules``. Flask is the real package; no model, no network,
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

import threading
import time
import types
from collections.abc import Callable
from unittest.mock import MagicMock, patch

import numpy as np
import requests
from django.test import SimpleTestCase

from api.runtime.http_timeouts import HEALTH_CHECK
from api.tests.sidecar_client import test_client
from api.tests.stubs import load_backend_file
from service._wsgi_server import WSGIServer

MODEL_NAME = "openclip_vitb32"


def _openclip_package_stub() -> dict[str, types.ModuleType]:
    """The ``openclip`` package main.py imports at top level, with a fake OpenCLIP."""
    pkg = types.ModuleType("openclip")
    pkg.__path__ = []
    sub = types.ModuleType("openclip.openclip")
    sub.OpenCLIP = MagicMock(name="OpenCLIP")
    sub.MODEL_NAME = MODEL_NAME
    sub.DEFAULT_MIN_PROBABILITY = 0.0075
    sub.DEFAULT_MAX_TAGS = 10
    pkg.openclip = sub
    return {"openclip": pkg, "openclip.openclip": sub}


def _load_tags_main():
    # The stub only has to make main.py's top-level import resolve. stub_modules
    # puts back the previous sys.modules entries afterwards, so later test
    # modules still see the real package.
    return load_backend_file(
        "service/tags/main.py",
        name="service_tags_main_test",
        stubs=_openclip_package_stub(),
    )


tags_main = _load_tags_main()


class TagsServiceBase(SimpleTestCase):
    def setUp(self):
        tags_main.app.config["TESTING"] = False
        self.client = test_client(tags_main.app)
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


class TagsServiceTestCase(TagsServiceBase):
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
        self.model.embed_query.return_value = np.array([0.0, 1.0], np.float32)
        response = self.client.post("/query-embeddings", json={"query": "a dog"})

        self.assertEqual(response.get_json(), {"emb": [0.0, 1.0], "magnitude": 1.0})
        self.model.embed_query.assert_called_once_with("a dog")

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


def _wait_for(condition: Callable[[], bool]) -> None:
    deadline = time.monotonic() + 10
    while not condition():
        if time.monotonic() > deadline:
            raise AssertionError("timed out")
        time.sleep(0.01)


class BuildingTagEmbeddingsBase(TagsServiceBase):
    def setUp(self) -> None:
        super().setUp()
        self.model.is_loaded = False
        self.model.load_cached.return_value = False
        self.release = threading.Event()
        self.model.build_tag_embeddings.side_effect = lambda: self.release.wait(10)
        self.model.predict.side_effect = self._predict_as_before
        self.addCleanup(self._finish_build)

    def _predict_as_before(self, *_args: object, **_kwargs: object) -> dict:
        if not self.model.is_loaded:
            self.release.wait(10)
        return {"tags": ["beach"]}

    def _finish_build(self) -> None:
        self.release.set()
        _wait_for(lambda: not tags_main.tag_embeddings_build.running())

    def _built(self) -> None:
        self._finish_build()

        def load_cached() -> bool:
            self.model.is_loaded = True
            return True

        self.model.load_cached.side_effect = load_cached


class TagEmbeddingsBuildTest(BuildingTagEmbeddingsBase):
    def test_tagging_is_a_503_while_the_tag_embeddings_build(self):
        responses = [self._post(image_path="/a.jpg") for _ in range(3)]

        self.assertEqual([r.status_code for r in responses], [503, 503, 503])
        self.assertEqual(responses[0].get_json()["code"], "loading")
        self.assertEqual(self.model.build_tag_embeddings.call_count, 1)
        self.model.predict.assert_not_called()

    def test_health_reports_the_build_and_refuses_an_unload(self):
        self._post(image_path="/a.jpg")

        health = self.client.get("/health").get_json()

        self.assertEqual((health["loading"], health["busy"]), (True, True))
        self.assertEqual(self.client.post("/unload-model").status_code, 409)
        self.assertIn(MODEL_NAME, tags_main.tagger_instances)

    def test_tagging_works_once_the_build_is_done(self):
        self._post(image_path="/a.jpg")
        self._built()

        response = self._post(image_path="/a.jpg")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.get_json(), {"tags": {"tags": ["beach"]}})
        self.assertFalse(self.client.get("/health").get_json()["loading"])

    def test_a_cached_model_loads_in_the_request(self):
        self._built()

        self.assertEqual(self._post(image_path="/a.jpg").status_code, 200)
        self.model.build_tag_embeddings.assert_not_called()

    def test_embeddings_come_without_tags_while_the_build_runs(self):
        self.model.embed_images_raw.return_value = [np.array([3.0, 4.0], np.float32)]

        response = self.client.post(
            "/clip-embeddings", json={"imgs": ["/a.jpg"], "with_tags": True}
        )

        self.assertEqual(
            response.get_json(), {"imgs_emb": [[3.0, 4.0]], "magnitudes": [5.0]}
        )
        self.assertTrue(tags_main.tag_embeddings_build.running())
        self.model.tags_for.assert_not_called()

    def test_a_failed_build_is_logged_and_the_next_request_tries_again(self):
        self.model.build_tag_embeddings.side_effect = RuntimeError("no text tower")

        with self.assertLogs("tags", "ERROR"):
            self._post(image_path="/a.jpg")
            _wait_for(lambda: not tags_main.tag_embeddings_build.running())
        self.model.build_tag_embeddings.side_effect = None
        self._post(image_path="/a.jpg")

        self.assertEqual(self.model.build_tag_embeddings.call_count, 2)


class SlowFirstBuildOverTheServerTest(BuildingTagEmbeddingsBase):
    def setUp(self) -> None:
        super().setUp()
        self.server = WSGIServer(("127.0.0.1", 0), tags_main.app, tags_main.log)
        thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        thread.start()
        self.addCleanup(thread.join, 10)
        self.addCleanup(self.server.stop)
        host, port = self.server.address
        self.url = f"http://{host}:{port}"

    def test_health_answers_the_watchdog_while_the_build_runs(self):
        tagging = requests.post(
            f"{self.url}/generate-tags", json={"image_path": "/a.jpg"}, timeout=(5, 5)
        )
        health = requests.get(f"{self.url}/health", timeout=HEALTH_CHECK)

        self.assertEqual(tagging.status_code, 503)
        self.assertEqual(health.status_code, 200)
        self.assertTrue(health.json()["loading"])
