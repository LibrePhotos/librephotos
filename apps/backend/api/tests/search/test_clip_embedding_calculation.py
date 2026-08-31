"""Characterization tests for ``SemanticSearch.calculate_clip_embeddings``.

Target: ``service/clip_embeddings/semantic_search/semantic_search.py``.

No real model is ever loaded: ``SentenceTransformer`` is patched in the
module namespace and ``PIL.Image.open`` is patched, so nothing touches the
network, the filesystem or a GPU.  Real (CPU) ``torch`` tensors are used as
the fake encoder output because the production code calls ``.cpu()``,
``.numpy()``, ``.tolist()`` and iterates over the result.

Quirks pinned here that a refactor must preserve:
  * The model is loaded lazily and ONLY when ``model_is_loaded`` is falsy;
    ``load()`` sets the flag even though nothing verifies the load worked.
  * The branch that decides "batch" vs "single" is ``type(x) is list`` --
    an exact type check.  A tuple, a ``PosixPath``, a ``str`` or even a
    ``list`` subclass all take the *single image* path.
  * ``PIL.UnidentifiedImageError`` is swallowed per image (with a ``print``)
    -- a bad image in a batch is silently dropped, so the returned
    embeddings can be SHORTER than ``img_paths`` and there is no way for the
    caller to tell which path failed.
  * Any OTHER exception from ``PIL.Image.open`` (e.g. ``FileNotFoundError``)
    is NOT caught and propagates out of the method un-printed.
  * ``encode`` is always called with ``batch_size=32`` and
    ``convert_to_tensor=True``, even for a single image.
  * CPU + list returns a lazy ``map`` object for the magnitudes (NOT a
    list); CUDA + list returns a real ``list`` of numpy floats.  Callers
    that iterate twice, take ``len()`` or index the magnitudes work only in
    the CUDA case.
  * The single-image branch returns a plain Python ``list`` for the
    embedding, the list branch returns the raw tensor.
  * Every exception raised inside the ``try`` (including an ``IndexError``
    from ``imgs_emb[0]`` when every image failed to open) is printed and
    re-raised unchanged.
"""

import os
import sys
from pathlib import Path
from unittest.mock import MagicMock, patch

import numpy as np
import PIL.Image
import torch
from django.test import TestCase

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", ".."))

from service.clip_embeddings.semantic_search.semantic_search import (  # noqa: E402
    SemanticSearch,
)

MODULE = "service.clip_embeddings.semantic_search.semantic_search"


def make_embeddings(rows):
    return torch.tensor(rows, dtype=torch.float32)


class CalculateClipEmbeddingsTestCase(TestCase):
    """Behavior of ``SemanticSearch.calculate_clip_embeddings``."""

    def setUp(self):
        self.search = SemanticSearch()
        self.model = MagicMock()
        # Default: two 2-d embeddings with easy norms (5.0 and 10.0).
        self.model.encode.return_value = make_embeddings([[3.0, 4.0], [6.0, 8.0]])
        self.search.model = self.model
        self.search.model_is_loaded = True

    # ------------------------------------------------------------------
    # model loading branch
    # ------------------------------------------------------------------

    def test_model_is_loaded_lazily_when_flag_is_false(self):
        search = SemanticSearch()
        self.assertFalse(search.model_is_loaded)
        fake_model = MagicMock()
        fake_model.encode.return_value = make_embeddings([[3.0, 4.0]])

        with patch(f"{MODULE}.SentenceTransformer", return_value=fake_model) as st:
            with patch("PIL.Image.open", return_value=MagicMock()):
                search.calculate_clip_embeddings("/photo.jpg", "clip-model-name")

        st.assert_called_once_with("clip-model-name")
        self.assertIs(search.model, fake_model)
        self.assertTrue(search.model_is_loaded)

    def test_model_is_not_reloaded_when_already_loaded(self):
        with patch(f"{MODULE}.SentenceTransformer") as st:
            with patch("PIL.Image.open", return_value=MagicMock()):
                self.search.calculate_clip_embeddings("/photo.jpg", "unused-model")

        st.assert_not_called()
        self.assertIs(self.search.model, self.model)

    # ------------------------------------------------------------------
    # CPU happy paths
    # ------------------------------------------------------------------

    def test_list_input_on_cpu_returns_tensor_and_lazy_map_of_magnitudes(self):
        img_a, img_b = MagicMock(name="a"), MagicMock(name="b")
        with patch("PIL.Image.open", side_effect=[img_a, img_b]):
            with patch("torch.cuda.is_available", return_value=False):
                embeddings, magnitudes = self.search.calculate_clip_embeddings(
                    ["/a.jpg", "/b.jpg"], "m"
                )

        # the encoder gets the opened PIL objects, in order
        self.model.encode.assert_called_once_with(
            [img_a, img_b], batch_size=32, convert_to_tensor=True
        )
        self.assertIsInstance(embeddings, torch.Tensor)
        self.assertEqual(embeddings.tolist(), [[3.0, 4.0], [6.0, 8.0]])
        # QUIRK: a lazy map object, not a list -- no len(), single use only
        self.assertIsInstance(magnitudes, map)
        self.assertEqual([float(m) for m in magnitudes], [5.0, 10.0])

    def test_cpu_list_magnitudes_map_is_exhausted_after_one_iteration(self):
        with patch("PIL.Image.open", return_value=MagicMock()):
            with patch("torch.cuda.is_available", return_value=False):
                _, magnitudes = self.search.calculate_clip_embeddings(["/a.jpg"], "m")

        self.assertEqual(len(list(magnitudes)), 2)
        self.assertEqual(list(magnitudes), [])

    def test_single_path_on_cpu_returns_plain_list_and_float_magnitude(self):
        img = MagicMock()
        with patch("PIL.Image.open", return_value=img) as opener:
            with patch("torch.cuda.is_available", return_value=False):
                embedding, magnitude = self.search.calculate_clip_embeddings(
                    "/only.jpg", "m"
                )

        opener.assert_called_once_with("/only.jpg")
        self.model.encode.assert_called_once_with(
            [img], batch_size=32, convert_to_tensor=True
        )
        self.assertIsInstance(embedding, list)
        self.assertEqual(embedding, [3.0, 4.0])
        # only the FIRST row of the encoder output is used
        self.assertAlmostEqual(float(magnitude), 5.0)
        self.assertIsInstance(magnitude, np.floating)

    def test_tuple_input_is_treated_as_a_single_path(self):
        """``type(x) is list`` is exact -- a tuple is handed to PIL as-is."""
        paths = ("/a.jpg", "/b.jpg")
        with patch("PIL.Image.open", return_value=MagicMock()) as opener:
            with patch("torch.cuda.is_available", return_value=False):
                embedding, _ = self.search.calculate_clip_embeddings(paths, "m")

        opener.assert_called_once_with(paths)
        self.assertEqual(embedding, [3.0, 4.0])

    def test_list_subclass_is_treated_as_a_single_path(self):
        class PathList(list):
            pass

        paths = PathList(["/a.jpg"])
        with patch("PIL.Image.open", return_value=MagicMock()) as opener:
            with patch("torch.cuda.is_available", return_value=False):
                self.search.calculate_clip_embeddings(paths, "m")

        opener.assert_called_once_with(paths)

    def test_pathlib_path_is_treated_as_a_single_path(self):
        p = Path("/tmp/pic.jpg")
        with patch("PIL.Image.open", return_value=MagicMock()) as opener:
            with patch("torch.cuda.is_available", return_value=False):
                embedding, _ = self.search.calculate_clip_embeddings(p, "m")

        opener.assert_called_once_with(p)
        self.assertEqual(embedding, [3.0, 4.0])

    # ------------------------------------------------------------------
    # CUDA happy paths
    # ------------------------------------------------------------------

    def test_list_input_on_cuda_returns_materialised_list_of_magnitudes(self):
        with patch("PIL.Image.open", return_value=MagicMock()):
            with patch("torch.cuda.is_available", return_value=True):
                embeddings, magnitudes = self.search.calculate_clip_embeddings(
                    ["/a.jpg", "/b.jpg"], "m"
                )

        self.assertIsInstance(embeddings, torch.Tensor)
        # QUIRK: a real list here, unlike the CPU branch
        self.assertIsInstance(magnitudes, list)
        self.assertEqual([float(m) for m in magnitudes], [5.0, 10.0])

    def test_single_path_on_cuda_returns_plain_list_and_float_magnitude(self):
        with patch("PIL.Image.open", return_value=MagicMock()):
            with patch("torch.cuda.is_available", return_value=True):
                embedding, magnitude = self.search.calculate_clip_embeddings(
                    "/only.jpg", "m"
                )

        self.assertIsInstance(embedding, list)
        self.assertEqual(embedding, [3.0, 4.0])
        self.assertAlmostEqual(float(magnitude), 5.0)

    # ------------------------------------------------------------------
    # unreadable images
    # ------------------------------------------------------------------

    def test_unidentified_image_in_a_batch_is_skipped_and_printed(self):
        good = MagicMock(name="good")
        with patch(
            "PIL.Image.open",
            side_effect=[good, PIL.UnidentifiedImageError("nope")],
        ):
            with patch("builtins.print") as printer:
                with patch("torch.cuda.is_available", return_value=False):
                    self.search.calculate_clip_embeddings(["/ok.jpg", "/bad.jpg"], "m")

        # the broken image never reaches the encoder
        self.model.encode.assert_called_once_with(
            [good], batch_size=32, convert_to_tensor=True
        )
        printer.assert_any_call("Error loading image: /bad.jpg")

    def test_unidentified_single_image_still_calls_encode_with_empty_list(self):
        """Every image failed -> ``imgs_emb[0]`` raises and is re-raised."""
        self.model.encode.return_value = make_embeddings([]).reshape(0, 2)
        with patch("PIL.Image.open", side_effect=PIL.UnidentifiedImageError("nope")):
            with patch("builtins.print") as printer:
                with patch("torch.cuda.is_available", return_value=False):
                    with self.assertRaises(IndexError):
                        self.search.calculate_clip_embeddings("/bad.jpg", "m")

        self.model.encode.assert_called_once_with(
            [], batch_size=32, convert_to_tensor=True
        )
        printer.assert_any_call("Error loading image: /bad.jpg")

    def test_empty_list_input_encodes_nothing_and_returns_empty_results(self):
        self.model.encode.return_value = make_embeddings([]).reshape(0, 2)
        with patch("PIL.Image.open") as opener:
            with patch("torch.cuda.is_available", return_value=False):
                embeddings, magnitudes = self.search.calculate_clip_embeddings([], "m")

        opener.assert_not_called()
        self.model.encode.assert_called_once_with(
            [], batch_size=32, convert_to_tensor=True
        )
        self.assertEqual(list(embeddings), [])
        self.assertEqual(list(magnitudes), [])

    def test_non_unidentified_open_error_propagates_uncaught(self):
        """Only ``UnidentifiedImageError`` is guarded -- OSError escapes."""
        with patch("PIL.Image.open", side_effect=FileNotFoundError("missing")):
            with patch("builtins.print") as printer:
                with self.assertRaises(FileNotFoundError):
                    self.search.calculate_clip_embeddings(["/gone.jpg"], "m")

        self.model.encode.assert_not_called()
        printer.assert_not_called()

    # ------------------------------------------------------------------
    # encoder failures
    # ------------------------------------------------------------------

    def test_encode_failure_is_printed_and_re_raised_unchanged(self):
        boom = RuntimeError("CUDA OOM")
        self.model.encode.side_effect = boom
        with patch("PIL.Image.open", return_value=MagicMock()):
            with patch("builtins.print") as printer:
                with self.assertRaises(RuntimeError) as ctx:
                    self.search.calculate_clip_embeddings(["/a.jpg"], "m")

        self.assertIs(ctx.exception, boom)
        printer.assert_any_call("Error in calculating clip embeddings: CUDA OOM")
