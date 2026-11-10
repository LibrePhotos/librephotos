"""The similarity index without FAISS: same answers, memory-mapped files.

``image_similarity/retrieval_index.py`` searches a float32 matrix with numpy
where it used FAISS's ``IndexFlatIP``. The fixtures under
``api/tests/fixtures/similarity`` were written by the FAISS version
(faiss-cpu 1.15.1): ``similarity_v1_*.npz`` exactly as it saved a user's index,
and ``similarity_v1_ties_expected.json`` what its ``search_similar`` answered
for 135 searches over an index with duplicate rows (ties).
"""

import heapq
import importlib
import json
import os
import shutil
import tempfile
import zipfile
from pathlib import Path
from unittest.mock import patch

import numpy as np
from django.test import SimpleTestCase

retrieval_index = importlib.import_module("image_similarity.retrieval_index")
RetrievalIndex = retrieval_index.RetrievalIndex
DIM = retrieval_index.embedding_size
FIXTURES = Path(__file__).resolve().parents[1] / "fixtures" / "similarity"


def unit(axis, scale=1.0):
    vector = [0.0] * DIM
    vector[axis] = scale
    return vector


def faiss_heap(scores, k):
    """The rows IndexFlatIP keeps for ``k``: its heap walk, written out."""
    heap = []  # (score, row): the smallest score, then the smallest row, on top
    for row, score in enumerate(scores):
        entry = (float(score), row)
        if len(heap) < k:
            heapq.heappush(heap, entry)
        elif entry[0] > heap[0][0]:
            heapq.heapreplace(heap, entry)
    return sorted(row for _, row in heap)


class TopKTest(SimpleTestCase):
    def test_the_rows_faiss_keeps_on_ties(self):
        rng = np.random.default_rng(1)
        for _ in range(300):
            count = int(rng.integers(1, 40))
            # Few distinct values: ties everywhere, at the boundary too.
            scores = rng.integers(0, 4, count).astype(np.float32)
            k = int(rng.integers(1, count + 3))
            with self.subTest(scores=scores.tolist(), k=k):
                self.assertEqual(
                    sorted(retrieval_index.top_k(scores, k).tolist()),
                    faiss_heap(scores, min(k, count)),
                )

    def test_ranked_best_first_and_the_higher_row_first_on_ties(self):
        scores = np.array([4, 4, 8, 4, 8, 4], dtype=np.float32)
        rows = np.arange(6)
        self.assertEqual(
            retrieval_index.ranked(scores, rows).tolist(), [4, 2, 5, 3, 1, 0]
        )


class _Store(SimpleTestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.store = os.path.join(self.tmp.name, "similarity")
        os.makedirs(self.store)

    def index_at(self, **kwargs):
        index = RetrievalIndex(self.store, **kwargs)
        self.addCleanup(index.close)  # Windows cannot delete a mapped file
        return index

    def legacy(self, fixture, user_id=7):
        target = os.path.join(self.store, f"{user_id}.npz")
        shutil.copy(FIXTURES / fixture, target)
        return target

    def rebuild(self, index, user_id, pages):
        token = index.begin_rebuild(user_id)
        for hashes, embeddings in pages:
            index.add_to_rebuild(user_id, token, hashes, embeddings)
        return index.commit_rebuild(user_id, token)

    def manifest(self, user_id):
        with open(
            os.path.join(self.store, f"{user_id}.index.json"), encoding="utf-8"
        ) as handle:
            return json.load(handle)


class SameAnswersAsFaissTest(_Store):
    """The FAISS version's answers over an index with duplicate rows."""

    def test_every_recorded_search(self):
        with open(
            FIXTURES / "similarity_v1_ties_expected.json", encoding="utf-8"
        ) as handle:
            expected = json.load(handle)
        self.legacy("similarity_v1_ties.npz")
        index = self.index_at()
        for case in expected["cases"]:
            query = expected["queries"][case["query"]]
            with self.subTest(
                query=case["query"], n=case["n"], threshold=case["threshold"]
            ):
                self.assertEqual(
                    index.search_similar(
                        7, query, n=case["n"], thres=case["threshold"]
                    ),
                    case["result"],
                )

    def test_the_same_scores(self):
        with open(
            FIXTURES / "similarity_v1_ties_expected.json", encoding="utf-8"
        ) as handle:
            expected = json.load(handle)
        self.legacy("similarity_v1_ties.npz")
        index = self.index_at()
        index.search_similar(7, expected["queries"][0], n=1)
        matrix = index.indices[7].matrix()
        for case in expected["cases"]:
            query = np.array(expected["queries"][case["query"]], dtype=np.float32)
            scores = matrix @ query
            for row, score in zip(case["faiss_ids"], case["faiss_scores"]):
                if row >= 0:
                    self.assertAlmostEqual(
                        float(scores[row]), score, delta=1e-4 * max(1.0, abs(score))
                    )

    def test_edges(self):
        index = self.index_at()
        self.rebuild(index, 1, [(["a", "b"], [unit(0), unit(1)])])
        # More asked for than there are: no padding.
        self.assertEqual(
            index.search_similar(1, unit(0), n=100, thres=-1e30), ["a", "b"]
        )
        # FAISS refused these; the sidecar answers them with a 500.
        for embedding in (unit(0)[:10], [unit(0)], []):
            with self.assertRaises(ValueError):
                index.search_similar(1, embedding)
        with self.assertRaises(ValueError):
            index.search_similar(1, unit(0), n=0)

    def test_an_empty_index_answers_nothing(self):
        self.legacy("similarity_v1_empty.npz")
        index = self.index_at()
        self.assertEqual(index.search_similar(7, unit(0), thres=-1e30), [])
        self.assertEqual(index.indices[7].ntotal, 0)


class LegacyUpgradeTest(_Store):
    def test_a_faiss_index_is_converted_on_first_use(self):
        legacy = self.legacy("similarity_v1_ties.npz")
        index = self.index_at()
        with patch.object(retrieval_index, "logger") as logger:
            self.assertTrue(index.search_similar(7, unit(0), thres=-1e30))
        self.assertIn("converted", logger.info.call_args_list[0].args[0])
        self.assertFalse(os.path.exists(legacy))
        self.assertEqual(self.manifest(7)["count"], 40)
        self.assertIn("e9c2" + "0" * 28 + "ÄB", index.image_hashes[7])
        # And a restart reads the converted files.
        self.assertEqual(self.index_at().indices, {})
        self.assertEqual(
            len(self.index_at().search_similar(7, unit(0), n=40, thres=-1e30)), 40
        )

    def test_one_row(self):
        self.legacy("similarity_v1_one.npz")
        self.assertEqual(
            self.index_at().search_similar(7, unit(0), thres=-1e30), [f"{0:032x}1"]
        )

    def damaged(self, name, change):
        """The ties fixture with its ``index`` bytes changed by ``change``."""
        with np.load(FIXTURES / "similarity_v1_ties.npz") as stored:
            data = bytearray(stored["index"].tobytes())
            hashes = stored["image_hashes"]
        data, hashes = change(data, hashes)
        with open(os.path.join(self.store, name), "wb") as out:
            np.savez(
                out,
                index=np.frombuffer(bytes(data), dtype=np.uint8),
                image_hashes=hashes,
            )

    def assert_not_converted(self, user_id=7):
        legacy = os.path.join(self.store, f"{user_id}.npz")
        with patch.object(retrieval_index, "logger") as logger:
            self.assertEqual(
                self.index_at().search_similar(user_id, unit(0), thres=-1e30), []
            )
        self.assertIn("could not convert", logger.error.call_args.args[0])
        # Kept for now, and nothing half-written left behind.
        self.assertEqual(os.listdir(self.store), [os.path.basename(legacy)])

    def test_another_kind_of_index_is_not_converted(self):
        self.damaged("7.npz", lambda d, h: (b"IxF2" + d[4:], h))
        self.assert_not_converted()

    def test_another_dimension_is_not_converted(self):
        self.damaged(
            "7.npz", lambda d, h: (d[:4] + (128).to_bytes(4, "little") + d[8:], h)
        )
        self.assert_not_converted()

    def test_a_short_vector_block_is_not_converted(self):
        self.damaged("7.npz", lambda d, h: (d[:-4], h))
        self.assert_not_converted()

    def test_hashes_that_do_not_add_up_are_not_converted(self):
        self.damaged("7.npz", lambda d, h: (d, h[:-1]))
        self.assert_not_converted()

    def test_a_truncated_file_is_not_converted(self):
        legacy = self.legacy("similarity_v1_ties.npz")
        with open(legacy, "r+b") as handle:
            handle.truncate(os.path.getsize(legacy) // 2)
        self.assert_not_converted()

    def test_a_corrupted_vector_is_not_converted(self):
        legacy = self.legacy("similarity_v1_ties.npz")
        with zipfile.ZipFile(legacy) as archive:
            offset = archive.getinfo("index.npy").header_offset
        with open(legacy, "r+b") as handle:
            handle.seek(offset + 300)
            handle.write(b"\xff\xff\xff\xff")  # inside the member: its CRC fails
        self.assert_not_converted()

    def test_the_next_rebuild_replaces_an_unreadable_legacy_file(self):
        self.damaged("7.npz", lambda d, h: (b"IxF2" + d[4:], h))
        index = self.index_at()
        self.rebuild(index, 7, [(["a"], [unit(0)])])
        self.assertNotIn("7.npz", os.listdir(self.store))


class CrashConsistencyTest(_Store):
    def test_a_page_whose_manifest_was_never_written_is_not_there(self):
        index = self.index_at()
        index.build_index_for_user(1, ["a"], [unit(0)])
        with patch.object(
            RetrievalIndex, "_write_manifest", side_effect=OSError("killed")
        ):
            index.build_index_for_user(1, ["b"], [unit(1)])

        restarted = self.index_at()
        self.assertEqual(restarted.search_similar(1, unit(1), n=10, thres=-1e30), ["a"])
        # The next page overwrites what the interrupted one left behind.
        restarted.build_index_for_user(1, ["c"], [unit(2, 30.0)])
        again = self.index_at()
        self.assertEqual(again.image_hashes[1] if again._live(1) else None, ["a", "c"])
        self.assertEqual(again.search_similar(1, unit(2), n=1), ["c"])

    def test_torn_writes_past_the_committed_ends_are_ignored(self):
        index = self.index_at()
        self.rebuild(index, 1, [(["a", "b"], [unit(0), unit(1)])])
        manifest = self.manifest(1)
        index.close()
        with open(os.path.join(self.store, manifest["vectors"]), "ab") as handle:
            handle.write(b"\x01" * 1000)  # part of a row
        with open(os.path.join(self.store, manifest["hashes"]), "ab") as handle:
            handle.write(b"half-a-ha")
        restarted = self.index_at()
        self.assertEqual(
            restarted.search_similar(1, unit(1), n=10, thres=-1e30), ["b", "a"]
        )

    def test_hashes_and_vectors_that_disagree_are_ignored(self):
        index = self.index_at()
        self.rebuild(index, 1, [(["a", "b"], [unit(0), unit(1)])])
        manifest = self.manifest(1)
        index.close()
        with open(os.path.join(self.store, manifest["vectors"]), "r+b") as handle:
            handle.truncate(DIM * 4)  # one row for two hashes
        with patch.object(retrieval_index, "logger") as logger:
            self.assertEqual(self.index_at().search_similar(1, unit(0)), [])
        self.assertIn("ignoring it", logger.error.call_args.args[0])

    def test_a_manifest_naming_other_files_is_ignored(self):
        index = self.index_at()
        self.rebuild(index, 1, [(["a"], [unit(0)])])
        manifest = self.manifest(1)
        manifest["vectors"] = "../outside.f32"
        with open(
            os.path.join(self.store, "1.index.json"), "w", encoding="utf-8"
        ) as handle:
            json.dump(manifest, handle)
        self.assertEqual(self.index_at().search_similar(1, unit(0)), [])


class WhileServingTest(_Store):
    """Files that are memory-mapped are replaced and deleted (Windows refuses
    to delete or replace a mapped file)."""

    def serving(self):
        index = self.index_at()
        self.rebuild(index, 1, [(["old"], [unit(0, 30.0)])])
        self.assertEqual(index.search_similar(1, unit(0)), ["old"])  # mapped now
        return index

    def test_a_rebuild_committed_while_the_old_index_is_served(self):
        index = self.serving()
        old = self.manifest(1)
        token = index.begin_rebuild(1)
        index.add_to_rebuild(1, token, ["new"], [unit(0, 30.0)])
        self.assertEqual(index.search_similar(1, unit(0)), ["old"])
        index.commit_rebuild(1, token)

        self.assertEqual(index.search_similar(1, unit(0)), ["new"])
        names = os.listdir(self.store)
        self.assertNotIn(old["vectors"], names)
        self.assertNotIn(old["hashes"], names)
        self.assertEqual(self.index_at().search_similar(1, unit(0)), ["new"])

    def test_pages_added_while_the_index_is_served(self):
        index = self.serving()
        index.build_index_for_user(1, ["more"], [unit(1, 30.0)])
        self.assertEqual(index.search_similar(1, unit(1)), ["more"])
        self.assertEqual(self.index_at().search_similar(1, unit(1)), ["more"])

    def test_removing_a_user_while_the_index_is_served(self):
        index = self.serving()
        token = index.begin_rebuild(1)
        index.add_to_rebuild(1, token, ["staged"], [unit(0)])
        index.remove_user(1)
        self.assertEqual(os.listdir(self.store), [])
        self.assertEqual(self.index_at().search_similar(1, unit(0)), [])

    def test_a_file_that_could_not_be_deleted_is_swept_on_the_next_load(self):
        index = self.serving()
        token = index.begin_rebuild(1)
        index.add_to_rebuild(1, token, ["new"], [unit(0, 30.0)])
        old = self.manifest(1)
        with patch.object(
            retrieval_index.os, "remove", side_effect=PermissionError("held")
        ):
            index.commit_rebuild(1, token)
        self.assertIn(old["vectors"], os.listdir(self.store))

        self.index_at().search_similar(1, unit(0))
        self.assertNotIn(old["vectors"], os.listdir(self.store))

    def test_a_rebuild_never_maps_its_matrix(self):
        index = self.serving()
        token = index.begin_rebuild(1)
        for page in range(3):
            index.add_to_rebuild(1, token, [f"h{page}"], [unit(page)])
        staged = index._staging[1].rows
        self.assertIsNone(staged._map)
        self.assertEqual(index.staged_size(1, token), 3)
