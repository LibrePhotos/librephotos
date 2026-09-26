"""The similarity index survives a sidecar restart, and a rebuild is atomic.

The index used to live only in the sidecar's memory: a restart (the watchdog
killed idle sidecars every two minutes) left every user without similar
photos until the next Calculate CLIP embeddings job, and a search for a user
without an index was a KeyError, a 500 and an empty list with an error line
in the backend log. The rebuild deleted the index first and posted its pages
without looking at the answers, so a failed page left a partial index behind
and the job reported success.
"""

import importlib.util
import logging
import os
import sys
import tempfile
import types
from unittest.mock import MagicMock, patch

import numpy as np
import requests
from django.test import SimpleTestCase, TestCase

from api import batch_jobs
from api.image_similarity import (
    SimilarityIndexError,
    build_image_similarity_index,
    search_similar_embedding,
)
from api.models.long_running_job import LongRunningJob
from api.tests.utils import create_test_photos, create_test_user

BACKEND = os.path.dirname(
    os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
)


def _stub_utils():
    stub = types.ModuleType("utils")
    stub.logger = logging.getLogger("api.tests.search.similarity_index")
    return stub


def _import_retrieval_index():
    # retrieval_index imports ``utils`` by bare name; the real one would
    # reconfigure the test process's logging (see test_retrieval_index_build).
    if "image_similarity.retrieval_index" in sys.modules:
        return sys.modules["image_similarity.retrieval_index"]
    previous = sys.modules.get("utils")
    sys.modules["utils"] = _stub_utils()
    try:
        import image_similarity.retrieval_index as module
    finally:
        if previous is None:
            sys.modules.pop("utils", None)
        else:
            sys.modules["utils"] = previous
    return module


retrieval_index = _import_retrieval_index()
RetrievalIndex = retrieval_index.RetrievalIndex
DIM = retrieval_index.embedding_size


def _load_main(base_data):
    """image_similarity/main.py as ``python image_similarity/main.py`` runs it."""
    names = ("utils", "retrieval_index")
    previous = {name: sys.modules.get(name) for name in names}
    sys.modules["utils"] = _stub_utils()
    sys.modules["retrieval_index"] = retrieval_index
    try:
        with patch.dict(os.environ, {"BASE_DATA": base_data}):
            spec = importlib.util.spec_from_file_location(
                "image_similarity_main_under_test",
                os.path.join(BACKEND, "image_similarity", "main.py"),
            )
            module = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(module)
    finally:
        for name, module_before in previous.items():
            if module_before is None:
                sys.modules.pop(name, None)
            else:
                sys.modules[name] = module_before
    return module


def unit(axis):
    vector = [0.0] * DIM
    vector[axis] = 1.0
    return vector


class _TempStore(SimpleTestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.store = os.path.join(self.tmp.name, "similarity")

    def rebuild(self, index, user_id, pages):
        index.begin_rebuild(user_id)
        for hashes, embeddings in pages:
            index.add_to_rebuild(user_id, hashes, embeddings)
        return index.commit_rebuild(user_id)


class PersistenceTest(_TempStore):
    def test_a_restarted_sidecar_answers_from_the_saved_index(self):
        self.rebuild(RetrievalIndex(self.store), 3, [(["a", "b"], [unit(0), unit(1)])])

        restarted = RetrievalIndex(self.store)
        self.assertEqual(restarted.indices, {})
        self.assertEqual(restarted.search_similar(3, unit(1), n=5, thres=0.5), ["b"])
        self.assertEqual(restarted.indices[3].ntotal, 2)

    def test_the_index_is_one_file_per_user(self):
        self.rebuild(RetrievalIndex(self.store), 3, [(["a"], [unit(0)])])

        self.assertEqual(os.listdir(self.store), ["3.npz"])

    def test_a_user_without_an_index_has_no_similar_photos(self):
        index = RetrievalIndex(self.store)
        with patch.object(retrieval_index, "logger") as logger:
            self.assertEqual(index.search_similar(9, unit(0)), [])
            self.assertEqual(index.search_similar(9, unit(0)), [])
        # The hint is logged once, not per search.
        logger.warning.assert_called_once()
        self.assertIn("Calculate CLIP embeddings", logger.warning.call_args.args[0])

    def test_fewer_photos_than_asked_for_are_not_padded(self):
        index = RetrievalIndex(self.store)
        self.rebuild(index, 1, [(["a"], [unit(0)])])

        self.assertEqual(index.search_similar(1, unit(0), n=10, thres=-1e30), ["a"])

    def test_a_file_that_does_not_add_up_is_ignored(self):
        os.makedirs(self.store)
        index = retrieval_index.faiss.IndexFlatIP(DIM)
        index.add(np.array([unit(0)], dtype=np.float32))
        with open(os.path.join(self.store, "4.npz"), "wb") as out:
            np.savez(
                out,
                index=retrieval_index.faiss.serialize_index(index),
                image_hashes=np.array(["a", "b"]),
            )

        self.assertEqual(RetrievalIndex(self.store).search_similar(4, unit(0)), [])

    def test_delete_forgets_the_file_too(self):
        index = RetrievalIndex(self.store)
        self.rebuild(index, 5, [(["a"], [unit(0)])])

        index.remove_user(5)

        self.assertEqual(os.listdir(self.store), [])
        self.assertEqual(RetrievalIndex(self.store).search_similar(5, unit(0)), [])

    def test_the_incremental_path_is_saved_as_well(self):
        RetrievalIndex(self.store).build_index_for_user(6, ["a"], [unit(0)])

        self.assertEqual(
            RetrievalIndex(self.store).search_similar(6, unit(0), thres=0.5), ["a"]
        )


class AtomicRebuildTest(_TempStore):
    def test_searches_use_the_old_index_until_the_rebuild_commits(self):
        index = RetrievalIndex(self.store)
        self.rebuild(index, 1, [(["old"], [unit(0)])])

        index.begin_rebuild(1)
        index.add_to_rebuild(1, ["new"], [unit(0)])
        self.assertEqual(index.search_similar(1, unit(0), thres=0.5), ["old"])

        index.commit_rebuild(1)
        self.assertEqual(index.search_similar(1, unit(0), thres=0.5), ["new"])

    def test_pages_add_up(self):
        index = RetrievalIndex(self.store)
        size = self.rebuild(
            index, 1, [(["a"], [unit(0)]), (["b", "c"], [unit(1), unit(2)])]
        )

        self.assertEqual(size, 3)
        self.assertEqual(index.image_hashes[1], ["a", "b", "c"])

    def test_a_failed_write_keeps_the_old_file_and_leaves_no_temporary(self):
        index = RetrievalIndex(self.store)
        self.rebuild(index, 1, [(["old"], [unit(0)])])

        index.begin_rebuild(1)
        index.add_to_rebuild(1, ["new"], [unit(0)])
        with patch.object(retrieval_index.os, "replace", side_effect=OSError("full")):
            with self.assertRaises(OSError):
                index.commit_rebuild(1)

        self.assertEqual(os.listdir(self.store), ["1.npz"])
        self.assertEqual(
            RetrievalIndex(self.store).search_similar(1, unit(0), thres=0.5), ["old"]
        )
        # Nor did the half-finished rebuild reach the live index.
        self.assertEqual(index.search_similar(1, unit(0), thres=0.5), ["old"])

    def test_a_page_with_mismatched_hashes_is_refused(self):
        index = RetrievalIndex(self.store)
        index.begin_rebuild(1)
        with self.assertRaises(retrieval_index.IndexBuildError):
            index.add_to_rebuild(1, ["a", "b"], [unit(0)])

    def test_a_page_without_a_begun_rebuild_is_refused(self):
        with self.assertRaises(retrieval_index.IndexBuildError):
            RetrievalIndex(self.store).commit_rebuild(1)


class SidecarRoutesTest(_TempStore):
    def setUp(self):
        super().setUp()
        self.main = _load_main(self.tmp.name)
        self.main.app.config["TESTING"] = True
        self.client = self.main.app.test_client()

    def test_the_index_lives_under_base_data(self):
        self.assertEqual(
            self.main.INDEX_ROOT,
            os.path.join(self.tmp.name, "protected_media", "similarity"),
        )

    def test_searching_a_user_without_an_index_is_an_empty_200(self):
        response = self.client.post(
            "/search/", json={"user_id": 1, "image_embedding": unit(0)}
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.get_json(), {"status": True, "result": []})

    def test_a_paged_rebuild_then_a_search(self):
        pages = [
            {"image_hashes": ["a"], "image_embeddings": [unit(0)], "begin": True},
            {"image_hashes": ["b"], "image_embeddings": [unit(1)]},
            {"image_hashes": [], "image_embeddings": [], "commit": True},
        ]
        sizes = []
        for page in pages:
            response = self.client.post("/build/", json={"user_id": 2, **page})
            self.assertEqual(response.status_code, 200, response.get_json())
            sizes.append(response.get_json()["index_size"])
        self.assertEqual(sizes, [1, 2, 2])

        response = self.client.post(
            "/search/",
            json={"user_id": 2, "image_embedding": unit(1), "threshold": 0.5},
        )
        self.assertEqual(response.get_json()["result"], ["b"])

    def test_a_bad_page_abandons_the_rebuild_with_a_400(self):
        self.client.post(
            "/build/",
            json={
                "user_id": 2,
                "image_hashes": ["a", "b"],
                "image_embeddings": [unit(0)],
                "begin": True,
            },
        )
        response = self.client.post(
            "/build/",
            json={
                "user_id": 2,
                "image_hashes": [],
                "image_embeddings": [],
                "commit": True,
            },
        )

        self.assertEqual(response.status_code, 400)
        self.assertIs(response.get_json()["status"], False)

    def test_a_user_id_must_be_an_integer(self):
        # It names a file under the index root.
        response = self.client.post(
            "/search/", json={"user_id": "../x", "image_embedding": unit(0)}
        )

        self.assertEqual(response.status_code, 400)

    def test_the_old_unflagged_build_and_delete_still_work(self):
        response = self.client.post(
            "/build/",
            json={"user_id": 3, "image_hashes": ["a"], "image_embeddings": [unit(0)]},
        )
        self.assertEqual(response.get_json(), {"status": True, "index_size": 1})

        response = self.client.delete("/build/", json={"user_id": 3})
        self.assertEqual(response.get_json(), {"status": True})


def _build_reply(status=True, index_size=0):
    response = MagicMock()
    response.status_code = 200
    response.raise_for_status.return_value = None
    response.json.return_value = {"status": status, "index_size": index_size}
    return response


def _error_reply(status_code=500):
    response = MagicMock()
    response.status_code = status_code
    response.json.return_value = {"status": False, "error": "disk full"}
    response.raise_for_status.side_effect = requests.HTTPError(
        f"{status_code} Error", response=response
    )
    return response


class BuildImageSimilarityIndexTest(TestCase):
    def setUp(self):
        self.user = create_test_user()

    def _with_embeddings(self, count):
        photos = create_test_photos(number_of_photos=count, owner=self.user)
        for number, photo in enumerate(photos):
            photo.clip_embeddings = unit(number)
            photo.save()
        return photos

    @patch("api.sidecars.http.delete")
    @patch("api.sidecars.http.post")
    def test_one_page_is_a_whole_rebuild(self, post, delete):
        self._with_embeddings(2)
        post.return_value = _build_reply(index_size=2)

        self.assertEqual(build_image_similarity_index(self.user), 2)

        delete.assert_not_called()
        post.assert_called_once()
        self.assertEqual(post.call_args.args[0], "http://127.0.0.1:8002/build/")
        body = post.call_args.kwargs["json"]
        self.assertEqual((body["begin"], body["commit"]), (True, True))
        self.assertEqual(len(body["image_hashes"]), 2)

    @patch("api.sidecars.http.post")
    def test_pages_are_flagged_first_and_last(self, post):
        self._with_embeddings(3)
        post.return_value = _build_reply()

        with patch("api.image_similarity.INDEX_PAGE_SIZE", 1):
            build_image_similarity_index(self.user)

        flags = [
            (call.kwargs["json"]["begin"], call.kwargs["json"]["commit"])
            for call in post.call_args_list
        ]
        self.assertEqual(flags, [(True, False), (False, False), (False, True)])

    @patch("api.sidecars.http.post")
    def test_a_user_without_embeddings_gets_an_empty_index(self, post):
        post.return_value = _build_reply()

        build_image_similarity_index(self.user)

        body = post.call_args.kwargs["json"]
        self.assertEqual(body["image_hashes"], [])
        self.assertEqual((body["begin"], body["commit"]), (True, True))

    @patch("api.sidecars.http.post")
    def test_an_error_reply_fails_the_rebuild(self, post):
        self._with_embeddings(1)
        post.return_value = _error_reply()

        with self.assertRaisesRegex(SimilarityIndexError, "disk full"):
            build_image_similarity_index(self.user)

    @patch("api.sidecars.http.post")
    def test_a_refused_page_fails_the_rebuild(self, post):
        self._with_embeddings(1)
        post.return_value = _build_reply(status=False)

        with self.assertRaises(SimilarityIndexError):
            build_image_similarity_index(self.user)

    @patch("api.sidecars.http.post")
    def test_an_unreachable_sidecar_fails_the_rebuild(self, post):
        post.side_effect = requests.ConnectionError("refused")

        with self.assertRaises(SimilarityIndexError):
            build_image_similarity_index(self.user)


class SearchSimilarEmbeddingTest(SimpleTestCase):
    @patch("api.sidecars.http.post")
    def test_an_error_reply_is_no_result(self, post):
        post.return_value = _error_reply()

        self.assertEqual(search_similar_embedding(1, unit(0)), [])

    @patch("api.sidecars.http.post")
    def test_the_result_is_returned(self, post):
        post.return_value = _build_reply()
        post.return_value.json.return_value = {"status": True, "result": ["a"]}

        self.assertEqual(search_similar_embedding(1, unit(0)), ["a"])


class ClipJobFailsWithTheIndexTest(TestCase):
    def test_a_failed_rebuild_fails_the_job(self):
        user = create_test_user()
        with (
            patch.object(
                batch_jobs,
                "build_image_similarity_index",
                side_effect=SimilarityIndexError("page 1 of 1 was refused"),
            ),
            self.assertRaises(SimilarityIndexError),
        ):
            batch_jobs.batch_calculate_clip_embedding(user)

        job = LongRunningJob.objects.filter(started_by=user).latest("queued_at")
        self.assertTrue(job.failed)
        self.assertTrue(job.finished)
        self.assertIn("refused", job.result["error"])
