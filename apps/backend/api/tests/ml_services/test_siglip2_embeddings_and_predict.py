"""Characterization tests for ``service.tags.siglip2.siglip2.SigLIP2``.

Pins the CURRENT behavior of ``SigLIP2._build_tag_embeddings`` and
``SigLIP2.predict`` before refactoring.  No ONNX model, tokenizer file,
network access or image file on disk is ever touched: ``ort.InferenceSession``
is replaced with a fake session, the SentencePiece tokenizer is injected as a
fake object (so ``_load_tokenizer`` short-circuits), ``PIL.Image.open`` is
patched to return an in-memory image, and ``np.save`` / ``os.makedirs`` are
patched so nothing is written to ``/protected_media``.

Behavior pinned here that a refactor must preserve:

``_build_tag_embeddings``
  * Always constructs an ``ort.InferenceSession`` for ``SIGLIP2_TEXT_PATH``
    with ``providers=["CPUExecutionProvider"]``.
  * Tags are prompted as ``f"a photo of {tag}"`` -- note there is no article,
    so the prompt for ``"cat"`` is ``"a photo of cat"``.
  * Batch size is hard-coded to 32; the last batch may be short.
  * The feed dict always maps the *first* text input name to ``input_ids``;
    ``attention_mask`` is only fed when the model declares >1 input.
  * ``session.run(None, feed)`` is called (all outputs requested).  The first
    output whose ``ndim == 2`` **and** ``shape[0] == len(batch_texts)`` wins.
    A 2-D output with a mismatching first dimension is skipped, and if no
    output qualifies, ``raw_outputs[0]`` is pooled via ``_pool_embeddings``
    with the attention mask (EOS pooling) -- even when ``raw_outputs[0]`` is
    itself the rejected 2-D array, in which case ``_pool_embeddings`` returns
    it unchanged (see ``test_two_d_output_with_wrong_batch_dim_*``).
  * Each batch is L2-normalized *before* concatenation.
  * Results are concatenated along axis 0, assigned to ``self.tag_embeddings``,
    the cache directory is created with ``exist_ok=True`` and the array is
    saved to ``SIGLIP2_EMBEDDINGS_CACHE``.
  * ``self.is_loaded`` is NOT set by this method (only ``load`` sets it).
  * Empty ``self.tags`` is not guarded: ``np.concatenate([])`` raises
    ``ValueError``, and the session is still constructed first.
  * ``self.tags = None`` raises ``TypeError`` from the list comprehension.

``predict``
  * Calls ``self.load()`` when ``is_loaded`` is falsy, and does not when it is
    truthy.  Note it checks the flag, not the presence of a session.
  * Picks the first vision output with ``ndim == 2 and shape[0] == 1``;
    otherwise pools ``raw_outputs[0]`` with ``attention_mask=None`` (position
    0 / CLS pooling).
  * Scores are cosine similarities against ``self.tag_embeddings.T``.
  * Ranking uses ``np.argsort(scores)[::-1]`` and **breaks** (does not
    ``continue``) at the first score below ``threshold`` -- so the result is a
    prefix of the ranked list.
  * ``max_tags`` caps the list; ``max_tags=0`` still returns one tag because
    the cap is checked *after* the append (see ``test_max_tags_zero_...``).
  * Returns ``{"tags": [...]}``.
"""

from unittest.mock import MagicMock, patch

import numpy as np
from django.test import TestCase
from PIL import Image

from service.tags.siglip2.siglip2 import (
    SigLIP2,
    _l2_normalize,
    _pool_embeddings,
)

MODULE = "service.tags.siglip2.siglip2"


class FakeIO:
    def __init__(self, name):
        self.name = name


class FakeSession:
    """Stands in for ``onnxruntime.InferenceSession``."""

    def __init__(self, input_names, output_names=None, outputs_fn=None):
        self._inputs = [FakeIO(n) for n in input_names]
        self._outputs = [FakeIO(n) for n in (output_names or ["out"])]
        self._outputs_fn = outputs_fn
        self.feeds = []

    def get_inputs(self):
        return self._inputs

    def get_outputs(self):
        return self._outputs

    def run(self, output_names, feed):
        self.feeds.append((output_names, feed))
        return self._outputs_fn(feed)


class FakeTokenizer:
    """Stands in for ``sentencepiece.SentencePieceProcessor``."""

    def Encode(self, text):  # noqa: N802 - mirrors sentencepiece API
        return [2, 3, 4]


def make_model(tags, tokenizer=True):
    model = SigLIP2()
    model.tags = list(tags) if tags is not None else None
    if tokenizer:
        model.tokenizer = FakeTokenizer()
    return model


class BuildTagEmbeddingsTests(TestCase):
    """Characterize ``SigLIP2._build_tag_embeddings``."""

    def setUp(self):
        patcher_save = patch(f"{MODULE}.np.save")
        patcher_makedirs = patch(f"{MODULE}.os.makedirs")
        self.mock_save = patcher_save.start()
        self.mock_makedirs = patcher_makedirs.start()
        self.addCleanup(patcher_save.stop)
        self.addCleanup(patcher_makedirs.stop)

    def _build(self, model, session):
        with patch(f"{MODULE}.ort.InferenceSession", return_value=session) as ctor:
            model._build_tag_embeddings()
        return ctor

    def test_two_d_output_is_used_directly_and_l2_normalized(self):
        tags = ["cat", "dog", "tree"]
        raw = np.array(
            [[3.0, 4.0], [0.0, 5.0], [1.0, 0.0]],
            dtype=np.float32,
        )
        session = FakeSession(["input_ids"], outputs_fn=lambda feed: [raw])
        model = make_model(tags)

        self._build(model, session)

        expected = _l2_normalize(raw)
        np.testing.assert_allclose(model.tag_embeddings, expected, rtol=1e-6)
        self.assertEqual(model.tag_embeddings.shape, (3, 2))
        # Rows are unit length.
        np.testing.assert_allclose(
            np.linalg.norm(model.tag_embeddings, axis=1),
            np.ones(3),
            rtol=1e-6,
        )

    def test_session_constructed_for_text_model_with_cpu_provider(self):
        from service.tags.siglip2 import siglip2 as mod

        raw = np.ones((1, 4), dtype=np.float32)
        session = FakeSession(["input_ids"], outputs_fn=lambda feed: [raw])
        ctor = self._build(make_model(["cat"]), session)

        ctor.assert_called_once_with(
            mod.SIGLIP2_TEXT_PATH, providers=["CPUExecutionProvider"]
        )

    def test_single_input_model_only_feeds_input_ids(self):
        raw = np.ones((2, 4), dtype=np.float32)
        session = FakeSession(["input_ids"], outputs_fn=lambda feed: [raw])

        self._build(make_model(["cat", "dog"]), session)

        self.assertEqual(len(session.feeds), 1)
        output_names, feed = session.feeds[0]
        self.assertIsNone(output_names)
        self.assertEqual(list(feed.keys()), ["input_ids"])
        self.assertEqual(feed["input_ids"].shape, (2, 64))
        self.assertEqual(feed["input_ids"].dtype, np.int64)

    def test_two_input_model_also_feeds_attention_mask(self):
        raw = np.ones((2, 4), dtype=np.float32)
        session = FakeSession(
            ["input_ids", "attention_mask"], outputs_fn=lambda feed: [raw]
        )

        self._build(make_model(["cat", "dog"]), session)

        _, feed = session.feeds[0]
        self.assertEqual(set(feed.keys()), {"input_ids", "attention_mask"})
        mask = feed["attention_mask"]
        # FakeTokenizer yields 3 tokens + EOS = 4 attended positions.
        self.assertEqual(mask.shape, (2, 64))
        self.assertEqual(int(mask.sum(axis=1)[0]), 4)

    def test_third_input_name_is_ignored(self):
        raw = np.ones((1, 4), dtype=np.float32)
        session = FakeSession(
            ["input_ids", "attention_mask", "position_ids"],
            outputs_fn=lambda feed: [raw],
        )

        self._build(make_model(["cat"]), session)

        _, feed = session.feeds[0]
        self.assertEqual(set(feed.keys()), {"input_ids", "attention_mask"})

    def test_prompt_template_is_a_photo_of_tag(self):
        seen = []

        class RecordingTokenizer(FakeTokenizer):
            def Encode(self, text):  # noqa: N802
                seen.append(text)
                return [2, 3]

        model = make_model(["cat", "a red car"])
        model.tokenizer = RecordingTokenizer()
        raw = np.ones((2, 4), dtype=np.float32)
        session = FakeSession(["input_ids"], outputs_fn=lambda feed: [raw])

        self._build(model, session)

        self.assertEqual(seen, ["a photo of cat", "a photo of a red car"])

    def test_all_three_d_outputs_are_eos_pooled(self):
        # 4 attended positions -> EOS index 3.
        raw = np.zeros((2, 64, 3), dtype=np.float32)
        raw[0, 3] = [0.0, 3.0, 4.0]
        raw[1, 3] = [5.0, 0.0, 0.0]
        raw[:, 0] = 99.0  # position 0 must NOT be used
        session = FakeSession(["input_ids"], outputs_fn=lambda feed: [raw])
        model = make_model(["cat", "dog"])

        self._build(model, session)

        np.testing.assert_allclose(
            model.tag_embeddings,
            np.array([[0.0, 0.6, 0.8], [1.0, 0.0, 0.0]], dtype=np.float32),
            atol=1e-6,
        )

    def test_first_matching_two_d_output_wins_over_later_outputs(self):
        first = np.ones((2, 3), dtype=np.float32)
        second = np.full((2, 3), 7.0, dtype=np.float32)
        session = FakeSession(
            ["input_ids"],
            output_names=["a", "b"],
            outputs_fn=lambda feed: [first, second],
        )
        model = make_model(["cat", "dog"])

        self._build(model, session)

        np.testing.assert_allclose(model.tag_embeddings, _l2_normalize(first))

    def test_three_d_first_output_skipped_for_later_two_d_output(self):
        three_d = np.ones((2, 64, 3), dtype=np.float32)
        two_d = np.array([[0.0, 4.0, 3.0], [1.0, 0.0, 0.0]], dtype=np.float32)
        session = FakeSession(
            ["input_ids"],
            output_names=["a", "b"],
            outputs_fn=lambda feed: [three_d, two_d],
        )
        model = make_model(["cat", "dog"])

        self._build(model, session)

        np.testing.assert_allclose(model.tag_embeddings, _l2_normalize(two_d))

    def test_two_d_output_with_wrong_batch_dim_is_rejected_then_pooled_as_is(self):
        """A 2-D output whose batch dim mismatches is rejected by the loop but,
        being ``raw_outputs[0]``, is then returned unchanged by
        ``_pool_embeddings`` (which short-circuits on ``ndim == 2``)."""
        wrong = np.array([[3.0, 4.0]], dtype=np.float32)  # shape (1, 2), batch is 2
        session = FakeSession(["input_ids"], outputs_fn=lambda feed: [wrong])
        model = make_model(["cat", "dog"])

        self._build(model, session)

        self.assertEqual(model.tag_embeddings.shape, (1, 2))
        np.testing.assert_allclose(
            model.tag_embeddings, np.array([[0.6, 0.8]], dtype=np.float32), atol=1e-6
        )

    def test_batching_uses_batch_size_32_and_concatenates(self):
        tags = [f"tag{i}" for i in range(70)]

        def outputs(feed):
            n = feed["input_ids"].shape[0]
            return [np.full((n, 2), float(n), dtype=np.float32)]

        session = FakeSession(["input_ids"], outputs_fn=outputs)
        model = make_model(tags)

        self._build(model, session)

        batch_sizes = [f["input_ids"].shape[0] for _, f in session.feeds]
        self.assertEqual(batch_sizes, [32, 32, 6])
        self.assertEqual(model.tag_embeddings.shape, (70, 2))

    def test_embeddings_saved_to_cache_path_and_dir_created(self):
        from service.tags.siglip2 import siglip2 as mod

        raw = np.ones((1, 4), dtype=np.float32)
        session = FakeSession(["input_ids"], outputs_fn=lambda feed: [raw])
        model = make_model(["cat"])

        self._build(model, session)

        self.mock_makedirs.assert_called_once()
        args, kwargs = self.mock_makedirs.call_args
        self.assertEqual(kwargs, {"exist_ok": True})
        self.assertEqual(args[0], mod.SIGLIP2_MODEL_DIR)

        self.mock_save.assert_called_once()
        save_args = self.mock_save.call_args[0]
        self.assertEqual(save_args[0], mod.SIGLIP2_EMBEDDINGS_CACHE)
        np.testing.assert_allclose(save_args[1], model.tag_embeddings)

    def test_does_not_set_is_loaded(self):
        raw = np.ones((1, 4), dtype=np.float32)
        session = FakeSession(["input_ids"], outputs_fn=lambda feed: [raw])
        model = make_model(["cat"])

        self._build(model, session)

        self.assertFalse(model.is_loaded)

    def test_empty_tag_list_raises_value_error_after_session_is_built(self):
        session = FakeSession(["input_ids"], outputs_fn=lambda feed: [])
        model = make_model([])

        with patch(f"{MODULE}.ort.InferenceSession", return_value=session) as ctor:
            with self.assertRaises(ValueError):
                model._build_tag_embeddings()

        ctor.assert_called_once()
        self.assertEqual(session.feeds, [])
        self.mock_save.assert_not_called()

    def test_none_tags_raises_type_error(self):
        session = FakeSession(["input_ids"], outputs_fn=lambda feed: [])
        model = make_model(None)

        with patch(f"{MODULE}.ort.InferenceSession", return_value=session):
            with self.assertRaises(TypeError):
                model._build_tag_embeddings()

    def test_tokenizer_is_loaded_lazily_when_absent(self):
        raw = np.ones((1, 4), dtype=np.float32)
        session = FakeSession(["input_ids"], outputs_fn=lambda feed: [raw])
        model = make_model(["cat"], tokenizer=False)
        fake_proc = MagicMock()
        fake_proc.Encode.return_value = [5, 6]

        with patch(f"{MODULE}.ort.InferenceSession", return_value=session):
            with patch(
                f"{MODULE}.spm.SentencePieceProcessor", return_value=fake_proc
            ) as proc_ctor:
                model._build_tag_embeddings()

        proc_ctor.assert_called_once_with()
        fake_proc.Load.assert_called_once()
        self.assertIs(model.tokenizer, fake_proc)


class PredictTests(TestCase):
    """Characterize ``SigLIP2.predict``."""

    def setUp(self):
        self.image = Image.new("RGB", (8, 8), (10, 20, 30))
        patcher = patch.object(Image, "open", return_value=self.image)
        self.mock_open = patcher.start()
        self.addCleanup(patcher.stop)

    def _model(self, vision_outputs, tag_embeddings, tags):
        model = SigLIP2()
        model.tags = list(tags)
        model.tag_embeddings = np.array(tag_embeddings, dtype=np.float32)
        model.vision_session = FakeSession(
            ["pixel_values"], outputs_fn=lambda feed: vision_outputs
        )
        model.is_loaded = True
        return model

    def test_returns_top_tags_sorted_by_similarity(self):
        embeds = np.array([[1.0, 0.0]], dtype=np.float32)
        tag_embeddings = [[1.0, 0.0], [0.0, 1.0], [0.7071068, 0.7071068]]
        model = self._model([embeds], tag_embeddings, ["cat", "dog", "bird"])

        result = model.predict("/nonexistent/photo.jpg")

        self.assertEqual(result, {"tags": ["cat", "bird"]})

    def test_threshold_breaks_at_first_low_score(self):
        embeds = np.array([[1.0, 0.0]], dtype=np.float32)
        tag_embeddings = [[1.0, 0.0], [0.0, 1.0], [0.9, 0.0]]
        model = self._model([embeds], tag_embeddings, ["cat", "dog", "bird"])

        result = model.predict("/nonexistent/photo.jpg", threshold=0.95)

        self.assertEqual(result, {"tags": ["cat"]})

    def test_all_scores_below_threshold_returns_empty_list(self):
        embeds = np.array([[1.0, 0.0]], dtype=np.float32)
        model = self._model([embeds], [[0.0, 1.0]], ["dog"])

        self.assertEqual(model.predict("/x.jpg"), {"tags": []})

    def test_max_tags_caps_result(self):
        embeds = np.array([[1.0, 0.0]], dtype=np.float32)
        tag_embeddings = [[1.0, 0.0]] * 5
        model = self._model([embeds], tag_embeddings, list("abcde"))

        result = model.predict("/x.jpg", max_tags=2)

        self.assertEqual(len(result["tags"]), 2)

    def test_max_tags_zero_still_returns_one_tag(self):
        """The cap is checked after the append, so 0 behaves like 1."""
        embeds = np.array([[1.0, 0.0]], dtype=np.float32)
        model = self._model([embeds], [[1.0, 0.0], [1.0, 0.0]], ["cat", "dog"])

        result = model.predict("/x.jpg", max_tags=0)

        self.assertEqual(len(result["tags"]), 1)

    def test_negative_similarity_below_default_threshold_is_dropped(self):
        embeds = np.array([[1.0, 0.0]], dtype=np.float32)
        model = self._model([embeds], [[-1.0, 0.0]], ["dog"])

        self.assertEqual(model.predict("/x.jpg"), {"tags": []})

    def test_image_embeddings_are_l2_normalized_before_similarity(self):
        # Unnormalized vision output: magnitude must not inflate the score.
        embeds = np.array([[100.0, 0.0]], dtype=np.float32)
        model = self._model([embeds], [[1.0, 0.0]], ["cat"])

        with patch.object(SigLIP2, "prepare_image", wraps=model.prepare_image):
            result = model.predict("/x.jpg", threshold=0.99)

        # Score is exactly 1.0, not 100.
        self.assertEqual(result, {"tags": ["cat"]})

    def test_three_d_vision_output_is_pooled_at_position_zero(self):
        raw = np.zeros((1, 5, 2), dtype=np.float32)
        raw[0, 0] = [0.0, 2.0]  # CLS position
        raw[0, 4] = [2.0, 0.0]
        model = self._model([raw], [[0.0, 1.0], [1.0, 0.0]], ["cat", "dog"])

        result = model.predict("/x.jpg", threshold=0.5)

        self.assertEqual(result, {"tags": ["cat"]})

    def test_two_d_output_with_batch_gt_one_is_skipped(self):
        """Only a 2-D output with ``shape[0] == 1`` is accepted; otherwise the
        first output is pooled (and here it is 2-D, so returned unchanged)."""
        raw = np.array([[1.0, 0.0], [0.0, 1.0]], dtype=np.float32)
        model = self._model([raw], [[1.0, 0.0]], ["cat"])

        # similarities is (2, 1); scores = row 0 -> single score 1.0
        result = model.predict("/x.jpg", threshold=0.5)

        self.assertEqual(result, {"tags": ["cat"]})

    def test_first_qualifying_output_wins(self):
        good = np.array([[1.0, 0.0]], dtype=np.float32)
        other = np.array([[0.0, 1.0]], dtype=np.float32)
        model = self._model([good, other], [[1.0, 0.0], [0.0, 1.0]], ["cat", "dog"])

        result = model.predict("/x.jpg", threshold=0.5)

        self.assertEqual(result, {"tags": ["cat"]})

    def test_vision_session_is_run_with_prepared_pixel_values(self):
        embeds = np.array([[1.0, 0.0]], dtype=np.float32)
        model = self._model([embeds], [[1.0, 0.0]], ["cat"])

        model.predict("/some/path.jpg")

        self.mock_open.assert_called_once_with("/some/path.jpg")
        output_names, feed = model.vision_session.feeds[0]
        self.assertIsNone(output_names)
        self.assertEqual(list(feed.keys()), ["pixel_values"])
        self.assertEqual(feed["pixel_values"].shape, (1, 3, 384, 384))

    def test_load_is_called_when_not_loaded(self):
        model = SigLIP2()
        embeds = np.array([[1.0, 0.0]], dtype=np.float32)

        def fake_load():
            model.tags = ["cat"]
            model.tag_embeddings = np.array([[1.0, 0.0]], dtype=np.float32)
            model.vision_session = FakeSession(
                ["pixel_values"], outputs_fn=lambda feed: [embeds]
            )
            model.is_loaded = True

        with patch.object(SigLIP2, "load", side_effect=fake_load) as mock_load:
            result = model.predict("/x.jpg")

        mock_load.assert_called_once_with()
        self.assertEqual(result, {"tags": ["cat"]})

    def test_load_is_not_called_when_already_loaded(self):
        embeds = np.array([[1.0, 0.0]], dtype=np.float32)
        model = self._model([embeds], [[1.0, 0.0]], ["cat"])

        with patch.object(SigLIP2, "load") as mock_load:
            model.predict("/x.jpg")

        mock_load.assert_not_called()


class PoolingHelperTests(TestCase):
    """The helpers both target functions delegate to."""

    def test_pool_embeddings_returns_two_d_input_unchanged(self):
        arr = np.ones((3, 4), dtype=np.float32)
        self.assertIs(_pool_embeddings(arr), arr)

    def test_pool_embeddings_uses_last_attended_position(self):
        arr = np.arange(2 * 3 * 2, dtype=np.float32).reshape(2, 3, 2)
        mask = np.array([[1, 1, 0], [1, 1, 1]])
        np.testing.assert_allclose(
            _pool_embeddings(arr, mask), np.array([[2.0, 3.0], [10.0, 11.0]])
        )

    def test_pool_embeddings_without_mask_takes_position_zero(self):
        arr = np.arange(1 * 3 * 2, dtype=np.float32).reshape(1, 3, 2)
        np.testing.assert_allclose(_pool_embeddings(arr), np.array([[0.0, 1.0]]))

    def test_l2_normalize_clamps_zero_norm(self):
        arr = np.zeros((1, 3), dtype=np.float32)
        np.testing.assert_allclose(_l2_normalize(arr), np.zeros((1, 3)))
