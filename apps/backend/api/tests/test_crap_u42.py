"""Characterization tests for ``image_similarity.retrieval_index``.

Pins the CURRENT behavior of ``RetrievalIndex.build_index_for_user`` (and,
where it is needed to observe the resulting state, ``search_similar``).

No ML models, network or exiftool binaries are involved -- FAISS is a pure
in-process C++ library and is exercised for real, the module logger is
patched so the log side effects can be asserted.

Quirks pinned here that a refactor must preserve:
  * Early returns are *silent* -- the method always returns ``None`` and
    never raises for the guarded cases.
  * The per-user index and hash list are created **before** the shape
    validation runs, so a rejected call still leaves an empty
    ``IndexFlatIP`` in ``self.indices`` and an empty list in
    ``self.image_hashes`` as a side effect.
  * The ``image_embeddings`` falsy check happens before anything else, so
    ``None``/``[]`` never create an index at all.
  * A 1-D input is reshaped to ``(1, -1)`` **without** any length check, so
    a short 1-D vector reaches ``faiss.add`` and the resulting
    ``AssertionError`` is swallowed by the ``except Exception`` handler.
  * ``image_hashes`` and ``image_embeddings`` are never checked against each
    other: mismatched lengths are accepted and the hash list simply gets
    every hash appended (see ``test_hash_embedding_count_mismatch_*``).
  * BUG: ``if not image_embeddings`` evaluates the truthiness of a numpy
    array, so passing an ``ndarray`` with >1 element raises ``ValueError``
    before the method does anything (``test_multi_row_numpy_input_...``).
  * Ragged embedding lists are NOT guarded -- ``np.array`` raises
    ``ValueError`` out of the method.
  * The final "finished building index" log uses ``%d`` for the user id, so
    a non-integer user id raises ``TypeError`` on the happy path.
"""

import sys
from unittest.mock import patch

import numpy as np
from django.test import TestCase

# ``image_similarity`` is a standalone Flask process: ``retrieval_index`` does a
# top-level ``from utils import logger``, which normally resolves because the
# ``image_similarity`` directory is ``sys.path[0]`` of
# ``python image_similarity/main.py``. Importing the real ``utils`` here would
# run ``configure_standalone`` and rewire the shared logging config under the
# test process (breaking test_log_rotation), so a stub ``utils`` is installed
# just for the duration of the import — the tests patch the module logger anyway.
if "image_similarity.retrieval_index" not in sys.modules:
    import logging as _logging
    import types as _types

    _stub_utils = _types.ModuleType("utils")
    _stub_utils.logger = _logging.getLogger("api.tests.test_crap_u42")
    _prev_utils = sys.modules.get("utils")
    sys.modules["utils"] = _stub_utils
    try:
        import image_similarity.retrieval_index  # noqa: F401
    finally:
        if _prev_utils is not None:
            sys.modules["utils"] = _prev_utils
        else:
            del sys.modules["utils"]

from image_similarity.retrieval_index import (  # noqa: E402
    RetrievalIndex,
    embedding_size,
)


def vec(value=0.0, size=embedding_size):
    return [float(value)] * size


class BuildIndexForUserGuardTests(TestCase):
    """Branches that return early without touching FAISS."""

    def setUp(self):
        self.index = RetrievalIndex()
        patcher = patch("image_similarity.retrieval_index.logger")
        self.logger = patcher.start()
        self.addCleanup(patcher.stop)

    def test_fresh_instance_starts_empty(self):
        self.assertEqual(self.index.indices, {})
        self.assertEqual(self.index.image_hashes, {})

    def test_none_embeddings_returns_without_creating_index(self):
        self.assertIsNone(self.index.build_index_for_user(1, ["h1"], None))
        self.assertEqual(self.index.indices, {})
        self.assertEqual(self.index.image_hashes, {})
        self.logger.warning.assert_called_once()
        self.assertIn("No embeddings provided", self.logger.warning.call_args[0][0])

    def test_empty_list_embeddings_returns_without_creating_index(self):
        self.assertIsNone(self.index.build_index_for_user(1, [], []))
        self.assertEqual(self.index.indices, {})
        self.assertEqual(self.index.image_hashes, {})
        self.logger.warning.assert_called_once()

    def test_zero_size_array_returns_but_index_already_created(self):
        # [[]] is truthy and non-empty, so the guard above passes; the index
        # and hash list are created *before* the size check bails out.
        self.assertIsNone(self.index.build_index_for_user(7, ["h1"], [[]]))
        self.assertIn(7, self.index.indices)
        self.assertEqual(self.index.indices[7].ntotal, 0)
        self.assertEqual(self.index.image_hashes[7], [])
        self.assertIn("Empty embeddings array", self.logger.warning.call_args[0][0])

    def test_wrong_second_dimension_is_rejected(self):
        self.assertIsNone(self.index.build_index_for_user(7, ["h1"], [[1.0, 2.0, 3.0]]))
        self.assertEqual(self.index.indices[7].ntotal, 0)
        self.assertEqual(self.index.image_hashes[7], [])
        self.logger.error.assert_called_once()
        self.assertIn("Expected embedding size 512", self.logger.error.call_args[0][0])

    def test_three_dimensional_input_is_rejected(self):
        self.assertIsNone(self.index.build_index_for_user(7, ["h1"], [[vec(1.0)]]))
        self.assertEqual(self.index.indices[7].ntotal, 0)
        self.assertEqual(self.index.image_hashes[7], [])
        self.assertIn("Unexpected embedding shape", self.logger.error.call_args[0][0])

    def test_short_one_dimensional_vector_fails_inside_faiss_and_is_swallowed(self):
        # Reshaped to (1, 3) without a length check -> faiss raises
        # AssertionError -> caught by ``except Exception``.
        self.assertIsNone(self.index.build_index_for_user(7, ["h1"], [1.0, 2.0, 3.0]))
        self.assertEqual(self.index.indices[7].ntotal, 0)
        self.assertEqual(self.index.image_hashes[7], [])
        self.logger.error.assert_called_once()
        self.assertIn(
            "Error adding embeddings to index", self.logger.error.call_args[0][0]
        )

    def test_ragged_embeddings_raise_value_error(self):
        with self.assertRaises(ValueError):
            self.index.build_index_for_user(7, ["a", "b"], [vec(1.0), [1.0, 2.0]])
        # The index was still created before the failure.
        self.assertIn(7, self.index.indices)

    def test_non_int_user_id_raises_type_error_on_happy_path(self):
        # The trailing log line uses "%d" % user_id.
        with self.assertRaises(TypeError):
            self.index.build_index_for_user("bob", ["h1"], [vec(1.0)])
        # ... but the embedding was already added before the log call.
        self.assertEqual(self.index.indices["bob"].ntotal, 1)
        self.assertEqual(self.index.image_hashes["bob"], ["h1"])


class BuildIndexForUserHappyPathTests(TestCase):
    def setUp(self):
        self.index = RetrievalIndex()
        patcher = patch("image_similarity.retrieval_index.logger")
        self.logger = patcher.start()
        self.addCleanup(patcher.stop)

    def test_single_two_dimensional_vector(self):
        self.assertIsNone(self.index.build_index_for_user(1, ["h1"], [vec(1.0)]))
        self.assertEqual(self.index.indices[1].ntotal, 1)
        self.assertEqual(self.index.image_hashes[1], ["h1"])
        self.assertEqual(self.index.indices[1].d, embedding_size)
        self.logger.error.assert_not_called()
        self.logger.warning.assert_not_called()

    def test_flat_one_dimensional_vector_is_reshaped(self):
        self.assertIsNone(self.index.build_index_for_user(1, ["h1"], vec(1.0)))
        self.assertEqual(self.index.indices[1].ntotal, 1)
        self.assertEqual(self.index.image_hashes[1], ["h1"])

    def test_multiple_vectors(self):
        hashes = ["h1", "h2", "h3"]
        embeddings = [vec(1.0), vec(2.0), vec(3.0)]
        self.index.build_index_for_user(1, hashes, embeddings)
        self.assertEqual(self.index.indices[1].ntotal, 3)
        self.assertEqual(self.index.image_hashes[1], hashes)

    def test_multi_row_numpy_input_raises_value_error(self):
        # BUG (pinned as-is): the ``not image_embeddings`` guard evaluates the
        # truthiness of the whole array, which numpy refuses for arrays with
        # more than one element. A ndarray of embeddings can therefore never
        # be passed in, even though the body would handle it fine.
        embeddings = np.ones((2, embedding_size), dtype=np.float64)
        with self.assertRaises(ValueError):
            self.index.build_index_for_user(1, ["h1", "h2"], embeddings)
        self.assertEqual(self.index.indices, {})

    def test_second_call_appends_to_the_same_index(self):
        self.index.build_index_for_user(1, ["h1"], [vec(1.0)])
        first_index = self.index.indices[1]
        self.index.build_index_for_user(1, ["h2", "h3"], [vec(2.0), vec(3.0)])
        self.assertIs(self.index.indices[1], first_index)
        self.assertEqual(self.index.indices[1].ntotal, 3)
        self.assertEqual(self.index.image_hashes[1], ["h1", "h2", "h3"])

    def test_users_are_isolated(self):
        self.index.build_index_for_user(1, ["h1"], [vec(1.0)])
        self.index.build_index_for_user(2, ["h2", "h3"], [vec(2.0), vec(3.0)])
        self.assertEqual(self.index.indices[1].ntotal, 1)
        self.assertEqual(self.index.indices[2].ntotal, 2)
        self.assertEqual(self.index.image_hashes[1], ["h1"])
        self.assertEqual(self.index.image_hashes[2], ["h2", "h3"])

    def test_hash_embedding_count_mismatch_more_hashes(self):
        # No validation: all hashes are appended even though only one vector
        # was indexed.
        self.index.build_index_for_user(1, ["h1", "h2", "h3"], [vec(1.0)])
        self.assertEqual(self.index.indices[1].ntotal, 1)
        self.assertEqual(self.index.image_hashes[1], ["h1", "h2", "h3"])

    def test_hash_embedding_count_mismatch_fewer_hashes(self):
        self.index.build_index_for_user(1, ["h1"], [vec(1.0), vec(2.0)])
        self.assertEqual(self.index.indices[1].ntotal, 2)
        self.assertEqual(self.index.image_hashes[1], ["h1"])

    def test_logs_start_and_finish(self):
        self.index.build_index_for_user(1, ["h1"], [vec(1.0)])
        self.assertEqual(self.logger.info.call_count, 2)
        self.assertIn(
            "building index for user 1", self.logger.info.call_args_list[0][0][0]
        )
        self.assertIn(
            "finished building index for user", self.logger.info.call_args_list[1][0][0]
        )

    def test_hashes_list_is_copied_not_aliased(self):
        hashes = ["h1"]
        self.index.build_index_for_user(1, hashes, [vec(1.0)])
        hashes.append("mutated")
        self.assertEqual(self.index.image_hashes[1], ["h1"])


class BuildIndexThenSearchTests(TestCase):
    """The index built above must be usable by ``search_similar``."""

    def setUp(self):
        self.index = RetrievalIndex()
        patcher = patch("image_similarity.retrieval_index.logger")
        patcher.start()
        self.addCleanup(patcher.stop)

    def test_search_returns_hash_of_strongly_matching_vector(self):
        # Inner product of a 512-dim all-ones vector with itself is 512,
        # comfortably above the default threshold of 27.0.
        self.index.build_index_for_user(1, ["match", "other"], [vec(1.0), vec(0.0)])
        res = self.index.search_similar(1, vec(1.0), n=2)
        self.assertEqual(res, ["match"])

    def test_search_threshold_filters_everything_out(self):
        self.index.build_index_for_user(1, ["match"], [vec(1.0)])
        self.assertEqual(self.index.search_similar(1, vec(1.0), n=1, thres=1e9), [])

    def test_search_for_unknown_user_raises_key_error(self):
        with self.assertRaises(KeyError):
            self.index.search_similar(999, vec(1.0))
