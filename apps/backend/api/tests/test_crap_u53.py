"""Characterization tests for ``service.tags.siglip2.siglip2.SigLIP2.load``.

Pins the CURRENT behavior of ``SigLIP2.load`` before it is refactored.

Nothing heavy is ever touched: ``ort.InferenceSession`` is replaced by a
factory returning a sentinel, ``builtins.open`` is replaced by ``mock_open``
for ``tags.txt``, ``os.path.exists`` / ``np.load`` / ``os.remove`` are patched
so ``/protected_media`` is never read from or written to, and
``_build_tag_embeddings`` is patched out (it is characterized separately in
``test_crap_u52.py``).

Behavior pinned here that a refactor must preserve:

  * The vision session is built FIRST, before the tag file is read, via
    ``ort.InferenceSession(SIGLIP2_VISION_PATH, providers=["CPUExecutionProvider"])``
    and assigned to ``self.vision_session`` unconditionally.
  * ``tags.txt`` is opened with ``open(TAGS_FILE, "r")`` (text mode, no
    encoding argument) and parsed as ``[line.strip() for line in f
    if line.strip()]`` -- blank / whitespace-only lines are dropped and each
    retained line is stripped.
  * If ``SIGLIP2_EMBEDDINGS_CACHE`` does not exist -> ``_build_tag_embeddings``
    is called and ``np.load`` is never touched.
  * If it exists, the cache is loaded and validated in this order:
      1. ``ndim != 2``            -> rebuild ("cache has wrong shape ...")
      2. ``shape[0] != len(tags)`` -> rebuild ("cache has N tags but tags.txt has M")
      3. ``shape[1] < 128``        -> rebuild ("cache has dim=... likely stale ...")
    Only the FIRST failing check reports; the checks are ``elif``-chained.
    A rebuild does ``os.remove(SIGLIP2_EMBEDDINGS_CACHE)`` and then calls
    ``_build_tag_embeddings`` -- note ``self.tag_embeddings`` still holds the
    rejected array at the moment ``_build_tag_embeddings`` is entered.
  * dim == 128 is accepted (the check is ``< 128``, not ``<= 128``).
  * A valid cache is assigned by identity (no copy / no re-normalization) and
    only a log line is printed.
  * ``self.is_loaded = True`` is the LAST statement: any exception raised on
    the way (session construction, missing tags file, rebuild failure) leaves
    ``is_loaded`` False and propagates -- ``load`` has no error handling at all.
  * ``self.tokenizer`` is NOT loaded by ``load`` (it stays ``None``; it is
    lazily created by ``_load_tokenizer``).
  * ``load`` is not idempotent-guarded: calling it twice redoes all the work.
"""

import io
import os
from unittest.mock import MagicMock, patch

import numpy as np
from django.test import TestCase

from service.tags.siglip2 import siglip2 as siglip2_module
from service.tags.siglip2.siglip2 import SigLIP2

MODULE = "service.tags.siglip2.siglip2"

DEFAULT_TAGS_TEXT = "cat\ndog\n\n  bird  \n\n"
DEFAULT_TAGS = ["cat", "dog", "bird"]


class FakeTagsFile:
    """A minimal file object: iterating yields lines, usable as a context manager."""

    def __init__(self, text):
        self._text = text
        self.closed = False

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        self.closed = True
        return False

    def __iter__(self):
        return iter(io.StringIO(self._text))


class LoadTestBase(TestCase):
    """Shared harness that drives ``SigLIP2.load`` with everything faked out."""

    def setUp(self):
        self.model = SigLIP2()
        self.session = object()

    def run_load(
        self,
        *,
        tags_text=DEFAULT_TAGS_TEXT,
        cache_exists=False,
        cached=None,
        session_factory=None,
        open_side_effect=None,
        build_side_effect=None,
        model=None,
        expect_raises=None,
    ):
        """Call ``load`` with all I/O patched; returns a dict of the mocks + stdout."""
        model = model if model is not None else self.model

        if session_factory is None:
            session_factory = MagicMock(return_value=self.session)

        opened = []

        def fake_open(path, mode="r", *args, **kwargs):
            opened.append((path, mode, args, kwargs))
            if open_side_effect is not None:
                raise open_side_effect
            return FakeTagsFile(tags_text)

        np_load = MagicMock(return_value=cached)
        os_remove = MagicMock()
        build = MagicMock(side_effect=build_side_effect)
        stdout = io.StringIO()

        with (
            patch(MODULE + ".ort.InferenceSession", session_factory),
            patch("builtins.open", fake_open),
            patch(MODULE + ".os.path.exists", return_value=cache_exists) as exists,
            patch(MODULE + ".np.load", np_load),
            patch(MODULE + ".os.remove", os_remove),
            patch.object(type(model), "_build_tag_embeddings", build),
            patch("sys.stdout", stdout),
        ):
            if expect_raises is not None:
                with self.assertRaises(expect_raises) as ctx:
                    model.load()
                raised = ctx.exception
            else:
                model.load()
                raised = None

        return {
            "session_factory": session_factory,
            "opened": opened,
            "exists": exists,
            "np_load": np_load,
            "os_remove": os_remove,
            "build": build,
            "stdout": stdout.getvalue(),
            "raised": raised,
        }


class LoadHappyPathTests(LoadTestBase):
    def test_no_cache_builds_embeddings_and_marks_loaded(self):
        res = self.run_load(cache_exists=False)

        self.assertIs(self.model.vision_session, self.session)
        self.assertEqual(self.model.tags, DEFAULT_TAGS)
        self.assertTrue(self.model.is_loaded)
        res["build"].assert_called_once_with()
        res["np_load"].assert_not_called()
        res["os_remove"].assert_not_called()

    def test_vision_session_constructed_with_cpu_provider_and_vision_path(self):
        res = self.run_load()

        res["session_factory"].assert_called_once_with(
            siglip2_module.SIGLIP2_VISION_PATH,
            providers=["CPUExecutionProvider"],
        )

    def test_tags_file_opened_in_text_mode_without_encoding(self):
        res = self.run_load()

        self.assertEqual(len(res["opened"]), 1)
        path, mode, args, kwargs = res["opened"][0]
        self.assertEqual(path, siglip2_module.TAGS_FILE)
        self.assertEqual(mode, "r")
        self.assertEqual(args, ())
        self.assertEqual(kwargs, {})

    def test_blank_lines_dropped_and_lines_stripped(self):
        self.run_load(tags_text="  a  \n\n\t\n b\nc")

        self.assertEqual(self.model.tags, ["a", "b", "c"])

    def test_cache_existence_checked_against_cache_path(self):
        res = self.run_load()

        res["exists"].assert_called_once_with(siglip2_module.SIGLIP2_EMBEDDINGS_CACHE)

    def test_tokenizer_is_not_loaded_by_load(self):
        self.run_load()

        self.assertIsNone(self.model.tokenizer)

    def test_valid_cache_is_used_verbatim_and_no_rebuild(self):
        cached = np.zeros((3, 256), dtype=np.float32)

        res = self.run_load(cache_exists=True, cached=cached)

        self.assertIs(self.model.tag_embeddings, cached)
        res["build"].assert_not_called()
        res["os_remove"].assert_not_called()
        res["np_load"].assert_called_once_with(siglip2_module.SIGLIP2_EMBEDDINGS_CACHE)
        self.assertIn("loaded cached tag embeddings (3 tags, dim=256)", res["stdout"])
        self.assertTrue(self.model.is_loaded)

    def test_dim_exactly_128_is_accepted(self):
        cached = np.zeros((3, 128), dtype=np.float32)

        res = self.run_load(cache_exists=True, cached=cached)

        res["build"].assert_not_called()
        self.assertIs(self.model.tag_embeddings, cached)

    def test_empty_tags_file_with_empty_cache_is_considered_valid(self):
        # QUIRK: 0 tags matches a (0, 256) cache, so nothing is rebuilt and the
        # model reports itself loaded with no tags at all.
        cached = np.zeros((0, 256), dtype=np.float32)

        res = self.run_load(tags_text="\n\n", cache_exists=True, cached=cached)

        self.assertEqual(self.model.tags, [])
        res["build"].assert_not_called()
        self.assertTrue(self.model.is_loaded)

    def test_load_is_not_guarded_and_redoes_work_when_called_twice(self):
        cached = np.zeros((3, 256), dtype=np.float32)

        self.run_load(cache_exists=True, cached=cached)
        res = self.run_load(cache_exists=True, cached=cached)

        res["session_factory"].assert_called_once()
        res["np_load"].assert_called_once()
        self.assertEqual(len(res["opened"]), 1)


class LoadCacheInvalidationTests(LoadTestBase):
    def test_one_dimensional_cache_triggers_rebuild(self):
        cached = np.zeros((3,), dtype=np.float32)

        res = self.run_load(cache_exists=True, cached=cached)

        self.assertIn("cache has wrong shape (3,), rebuilding", res["stdout"])
        res["os_remove"].assert_called_once_with(
            siglip2_module.SIGLIP2_EMBEDDINGS_CACHE
        )
        res["build"].assert_called_once_with()
        self.assertTrue(self.model.is_loaded)

    def test_three_dimensional_cache_triggers_rebuild(self):
        cached = np.zeros((3, 4, 5), dtype=np.float32)

        res = self.run_load(cache_exists=True, cached=cached)

        self.assertIn("cache has wrong shape", res["stdout"])
        res["build"].assert_called_once_with()

    def test_tag_count_mismatch_triggers_rebuild(self):
        cached = np.zeros((7, 256), dtype=np.float32)

        res = self.run_load(cache_exists=True, cached=cached)

        self.assertIn("cache has 7 tags but tags.txt has 3, rebuilding", res["stdout"])
        res["os_remove"].assert_called_once()
        res["build"].assert_called_once_with()

    def test_small_dimension_triggers_rebuild(self):
        cached = np.zeros((3, 127), dtype=np.float32)

        res = self.run_load(cache_exists=True, cached=cached)

        self.assertIn("cache has dim=127", res["stdout"])
        self.assertIn("likely stale from a failed build", res["stdout"])
        res["build"].assert_called_once_with()

    def test_only_the_first_failing_check_is_reported(self):
        # Wrong ndim AND (vacuously) other problems: only the shape message wins.
        cached = np.zeros((7,), dtype=np.float32)

        res = self.run_load(cache_exists=True, cached=cached)

        self.assertIn("wrong shape", res["stdout"])
        self.assertNotIn("tags.txt has", res["stdout"])
        self.assertNotIn("dim=", res["stdout"])

    def test_tag_count_mismatch_wins_over_small_dimension(self):
        cached = np.zeros((7, 8), dtype=np.float32)

        res = self.run_load(cache_exists=True, cached=cached)

        self.assertIn("cache has 7 tags", res["stdout"])
        self.assertNotIn("likely stale", res["stdout"])

    def test_rejected_cache_still_set_on_instance_when_rebuild_starts(self):
        # QUIRK: the stale array is assigned to self.tag_embeddings before
        # validation, so _build_tag_embeddings sees the rejected array.
        cached = np.zeros((7, 256), dtype=np.float32)
        seen = {}

        def build_side_effect():
            seen["value"] = self.model.tag_embeddings

        res = self.run_load(
            cache_exists=True, cached=cached, build_side_effect=build_side_effect
        )

        self.assertIs(seen["value"], cached)
        res["build"].assert_called_once()


class LoadErrorPropagationTests(LoadTestBase):
    def test_session_construction_error_propagates_and_leaves_state_untouched(self):
        factory = MagicMock(side_effect=RuntimeError("no onnx model"))

        res = self.run_load(session_factory=factory, expect_raises=RuntimeError)

        self.assertEqual(str(res["raised"]), "no onnx model")
        self.assertIsNone(self.model.vision_session)
        self.assertIsNone(self.model.tags)
        self.assertFalse(self.model.is_loaded)
        self.assertEqual(res["opened"], [])

    def test_missing_tags_file_propagates_after_session_is_assigned(self):
        # QUIRK: the vision session is already attached to the instance even
        # though load() failed, so the object is left half-initialised.
        res = self.run_load(
            open_side_effect=FileNotFoundError("tags.txt"),
            expect_raises=FileNotFoundError,
        )

        self.assertIs(self.model.vision_session, self.session)
        self.assertIsNone(self.model.tags)
        self.assertFalse(self.model.is_loaded)
        res["exists"].assert_not_called()

    def test_build_failure_on_cold_start_propagates_and_is_loaded_stays_false(self):
        res = self.run_load(
            cache_exists=False, build_side_effect=OSError("boom"), expect_raises=OSError
        )

        self.assertEqual(str(res["raised"]), "boom")
        self.assertEqual(self.model.tags, DEFAULT_TAGS)
        self.assertFalse(self.model.is_loaded)

    def test_build_failure_during_rebuild_leaves_cache_already_deleted(self):
        # QUIRK: os.remove happens before the rebuild, so a failed rebuild
        # destroys the previous cache with nothing to fall back on.
        cached = np.zeros((7, 256), dtype=np.float32)

        res = self.run_load(
            cache_exists=True,
            cached=cached,
            build_side_effect=OSError("boom"),
            expect_raises=OSError,
        )

        res["os_remove"].assert_called_once_with(
            siglip2_module.SIGLIP2_EMBEDDINGS_CACHE
        )
        self.assertFalse(self.model.is_loaded)

    def test_np_load_error_propagates(self):
        with (
            patch(MODULE + ".ort.InferenceSession", return_value=self.session),
            patch("builtins.open", lambda *a, **kw: FakeTagsFile(DEFAULT_TAGS_TEXT)),
            patch(MODULE + ".os.path.exists", return_value=True),
            patch(MODULE + ".np.load", side_effect=ValueError("corrupt npy")),
            patch.object(SigLIP2, "_build_tag_embeddings", MagicMock()) as build,
            patch("sys.stdout", io.StringIO()),
        ):
            with self.assertRaises(ValueError):
                self.model.load()

        build.assert_not_called()
        self.assertFalse(self.model.is_loaded)

    def test_os_remove_error_propagates_before_rebuild(self):
        cached = np.zeros((3,), dtype=np.float32)

        with (
            patch(MODULE + ".ort.InferenceSession", return_value=self.session),
            patch("builtins.open", lambda *a, **kw: FakeTagsFile(DEFAULT_TAGS_TEXT)),
            patch(MODULE + ".os.path.exists", return_value=True),
            patch(MODULE + ".np.load", return_value=cached),
            patch(MODULE + ".os.remove", side_effect=PermissionError("locked")),
            patch.object(SigLIP2, "_build_tag_embeddings", MagicMock()) as build,
            patch("sys.stdout", io.StringIO()),
        ):
            with self.assertRaises(PermissionError):
                self.model.load()

        build.assert_not_called()
        self.assertFalse(self.model.is_loaded)


class LoadRealTagsFileTests(TestCase):
    """The one test that reads the real ``tags.txt`` shipped with the module."""

    def test_real_tags_file_parses_to_non_empty_stripped_unique_lines(self):
        model = SigLIP2()

        with (
            patch(MODULE + ".ort.InferenceSession", return_value=object()),
            patch(MODULE + ".os.path.exists", return_value=False),
            patch.object(SigLIP2, "_build_tag_embeddings", MagicMock()),
            patch("sys.stdout", io.StringIO()),
        ):
            model.load()

        self.assertTrue(os.path.exists(siglip2_module.TAGS_FILE))
        self.assertGreater(len(model.tags), 100)
        self.assertTrue(all(tag == tag.strip() and tag for tag in model.tags))
        self.assertTrue(model.is_loaded)

    def test_module_paths_point_at_protected_media_data_models(self):
        # Pinned so a refactor that moves the constants is caught here.
        self.assertTrue(
            siglip2_module.SIGLIP2_VISION_PATH.endswith("vision_model.onnx")
        )
        self.assertTrue(
            siglip2_module.SIGLIP2_EMBEDDINGS_CACHE.endswith("tag_embeddings.npy")
        )
        self.assertIn("siglip2", siglip2_module.SIGLIP2_MODEL_DIR)
