"""A similarity index rebuild is a session named by the token its begin answers.

Two rebuilds of one user's index (the embedding job and the upload follow-ups'
rebuild) used to share one staging index: the second begin wiped the first's
pages and the first's commit swapped in a partial index. A client that died
mid-rebuild left the staging behind for good, and every later page without
flags went into it and was never committed, until the sidecar restarted.
"""

import importlib
import os
import tempfile
from unittest.mock import MagicMock, patch

import requests
from django.test import SimpleTestCase, TestCase

from api.models.long_running_job import LongRunningJob
from api.search import embedding_jobs
from api.search.similarity import SimilarityIndexError, build_image_similarity_index
from api.tests.stubs import load_backend_file
from api.tests.utils import create_test_photos, create_test_user

retrieval_index = importlib.import_module("image_similarity.retrieval_index")
RetrievalIndex = retrieval_index.RetrievalIndex
RebuildNotOpenError = retrieval_index.RebuildNotOpenError
DIM = retrieval_index.embedding_size


def unit(axis):
    vector = [0.0] * DIM
    vector[axis] = 1.0
    return vector


class _Clock:
    def __init__(self):
        self.now = 1000.0

    def __call__(self):
        return self.now


class _Store(SimpleTestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.clock = _Clock()
        self.index = RetrievalIndex(
            os.path.join(self.tmp.name, "similarity"), clock=self.clock
        )
        self.addCleanup(self.index.close)  # Windows cannot delete a mapped file

    def found(self, axis):
        return self.index.search_similar(1, unit(axis), n=10, thres=0.5)


class RebuildSessionTest(_Store):
    def test_a_newer_begin_supersedes_the_older_rebuild(self):
        older = self.index.begin_rebuild(1)
        self.index.add_to_rebuild(1, older, ["a"], [unit(0)])
        newer = self.index.begin_rebuild(1)
        self.index.add_to_rebuild(1, newer, ["a"], [unit(0)])

        with self.assertRaises(RebuildNotOpenError) as raised:
            self.index.add_to_rebuild(1, older, ["b"], [unit(1)])
        self.assertTrue(raised.exception.superseded)
        with self.assertRaises(RebuildNotOpenError):
            self.index.commit_rebuild(1, older)

        self.index.add_to_rebuild(1, newer, ["b"], [unit(1)])
        self.assertEqual(self.index.commit_rebuild(1, newer), 2)
        self.assertEqual(self.index.image_hashes[1], ["a", "b"])

    def test_the_older_rebuilds_abandon_leaves_the_newer_one(self):
        older = self.index.begin_rebuild(1)
        newer = self.index.begin_rebuild(1)
        self.index.add_to_rebuild(1, newer, ["a"], [unit(0)])

        self.index.abandon_rebuild(1, older)

        self.assertEqual(self.index.commit_rebuild(1, newer), 1)

    def test_a_rebuild_nobody_continues_expires(self):
        token = self.index.begin_rebuild(1)
        self.index.add_to_rebuild(1, token, ["staged"], [unit(0)])
        self.clock.now += retrieval_index.REBUILD_TTL_SECONDS + 1

        self.index.build_index_for_user(1, ["live"], [unit(1)])

        self.assertEqual(self.found(1), ["live"])
        with self.assertRaises(RebuildNotOpenError) as raised:
            self.index.commit_rebuild(1, token)
        self.assertFalse(raised.exception.superseded)

    def test_each_page_keeps_a_slow_rebuild_alive(self):
        token = self.index.begin_rebuild(1)
        for axis in range(3):
            self.clock.now += retrieval_index.REBUILD_TTL_SECONDS - 1
            self.index.add_to_rebuild(1, token, [f"h{axis}"], [unit(axis)])

        self.assertEqual(self.index.commit_rebuild(1, token), 3)

    def test_an_incremental_page_during_a_rebuild_reaches_both_indices(self):
        self.index.build_index_for_user(1, ["old"], [unit(0)])
        token = self.index.begin_rebuild(1)
        self.index.add_to_rebuild(1, token, ["old"], [unit(0)])

        self.index.build_index_for_user(1, ["new"], [unit(1)])
        self.assertEqual(self.found(1), ["new"])

        self.index.commit_rebuild(1, token)
        self.assertEqual(self.found(1), ["new"])
        self.assertEqual(self.index.image_hashes[1], ["old", "new"])

    def test_an_unknown_token_is_not_open(self):
        with self.assertRaises(RebuildNotOpenError) as raised:
            self.index.add_to_rebuild(1, "nonsense", ["a"], [unit(0)])
        self.assertFalse(raised.exception.superseded)


def _load_main(base_data):
    with patch.dict(os.environ, {"BASE_DATA": base_data}):
        return load_backend_file(
            "image_similarity/main.py",
            name="image_similarity_main_sessions_under_test",
            stubs={"retrieval_index": retrieval_index},
        )


class RebuildRoutesTest(SimpleTestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.main = _load_main(self.tmp.name)
        self.addCleanup(self.main.index.close)
        self.main.app.config["TESTING"] = True
        self.client = self.main.app.test_client()

    def build(self, **page):
        body = {"user_id": 2, "image_hashes": [], "image_embeddings": [], **page}
        return self.client.post("/build/", json=body)

    def search(self, axis):
        response = self.client.post(
            "/search/",
            json={"user_id": 2, "image_embedding": unit(axis), "threshold": 0.5},
        )
        return response.get_json()["result"]

    def test_two_interleaved_rebuilds_commit_only_the_newer_whole_index(self):
        older = self.build(
            image_hashes=["a"], image_embeddings=[unit(0)], begin=True
        ).get_json()["rebuild_token"]
        newer = self.build(
            image_hashes=["a"], image_embeddings=[unit(0)], begin=True
        ).get_json()["rebuild_token"]

        response = self.build(rebuild_token=older, commit=True)
        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.get_json()["code"], "rebuild_superseded")

        self.build(image_hashes=["b"], image_embeddings=[unit(1)], rebuild_token=newer)
        response = self.build(rebuild_token=newer, commit=True)
        self.assertEqual(response.get_json()["index_size"], 2)
        self.assertEqual(self.search(1), ["b"])

    def test_a_page_without_a_token_goes_to_the_live_index(self):
        # A begun rebuild whose client never came back.
        self.build(image_hashes=["staged"], image_embeddings=[unit(0)], begin=True)

        response = self.build(image_hashes=["live"], image_embeddings=[unit(1)])

        self.assertEqual(response.get_json(), {"status": True, "index_size": 1})
        self.assertEqual(self.search(1), ["live"])

    def test_a_commit_without_a_token_is_refused(self):
        response = self.build(commit=True)

        self.assertEqual(response.status_code, 400)

    def test_an_expired_token_is_not_open(self):
        response = self.build(rebuild_token="0" * 32)

        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.get_json()["code"], "rebuild_not_open")

    def test_a_token_must_be_a_string(self):
        response = self.build(rebuild_token=7)

        self.assertEqual(response.status_code, 400)


def _reply(body, status_code=200):
    response = MagicMock(status_code=status_code)
    response.json.return_value = body
    if status_code >= 400:
        response.raise_for_status.side_effect = requests.HTTPError(
            f"{status_code} Error", response=response
        )
    else:
        response.raise_for_status.return_value = None
    return response


class ClientSessionTest(TestCase):
    def setUp(self):
        self.user = create_test_user()
        for number, photo in enumerate(
            create_test_photos(number_of_photos=3, owner=self.user)
        ):
            photo.clip_embeddings = unit(number)
            photo.clip_embeddings_model = "openclip_vitb32"
            photo.save()

    @patch("api.runtime.sidecars.http.post")
    def test_every_page_after_the_first_carries_the_begin_token(self, post):
        post.return_value = _reply(
            {"status": True, "index_size": 1, "rebuild_token": "t1"}
        )

        with patch("api.search.similarity.INDEX_PAGE_SIZE", 1):
            build_image_similarity_index(self.user)

        tokens = [
            call.kwargs["json"].get("rebuild_token") for call in post.call_args_list
        ]
        self.assertEqual(tokens, [None, "t1", "t1"])

    @patch("api.runtime.sidecars.http.post")
    def test_a_begin_answered_without_a_token_fails_the_rebuild(self, post):
        post.return_value = _reply({"status": True, "index_size": 1})

        with (
            patch("api.search.similarity.INDEX_PAGE_SIZE", 1),
            self.assertRaisesRegex(SimilarityIndexError, "rebuild_token"),
        ):
            build_image_similarity_index(self.user)
        post.assert_called_once()

    @patch("api.runtime.sidecars.http.post")
    def test_a_superseded_rebuild_leaves_the_job_to_the_newer_one(self, post):
        post.side_effect = [
            _reply({"status": True, "index_size": 1, "rebuild_token": "old"}),
            _reply(
                {"status": False, "error": "superseded", "code": "rebuild_superseded"},
                status_code=409,
            ),
        ]

        with patch("api.search.similarity.INDEX_PAGE_SIZE", 1):
            build_image_similarity_index(self.user)

        self.assertEqual(post.call_count, 2)

    @patch("api.runtime.sidecars.http.post")
    def test_an_expired_rebuild_still_fails(self, post):
        post.side_effect = [
            _reply({"status": True, "index_size": 1, "rebuild_token": "old"}),
            _reply(
                {"status": False, "error": "expired", "code": "rebuild_not_open"},
                status_code=409,
            ),
        ]

        with (
            patch("api.search.similarity.INDEX_PAGE_SIZE", 1),
            self.assertRaisesRegex(SimilarityIndexError, "expired"),
        ):
            build_image_similarity_index(self.user)

    @patch("api.runtime.sidecars.http.post")
    def test_the_embedding_job_completes_when_its_rebuild_was_superseded(self, post):
        post.return_value = _reply(
            {"status": False, "error": "superseded", "code": "rebuild_superseded"},
            status_code=409,
        )

        embedding_jobs.batch_calculate_clip_embedding(self.user)

        job = LongRunningJob.objects.filter(started_by=self.user).latest("queued_at")
        self.assertFalse(job.failed)
        self.assertTrue(job.finished)
