"""Characterization tests for ``Places365.inference_places365`` (CRAP unit 51).

Target: ``service/tags/places365/places365.py`` -> ``Places365.inference_places365``.

The real model is never loaded: the instance is pre-populated with tiny fake
labels/weights, ``returnTF`` is stubbed with an identity transform, ``Image.open``
is patched at module level, and the "model" is a small stand-in that returns a
fixed logit tensor and appends the feature blobs the hooks would normally add.

Everything asserted here is the CURRENT observed behaviour, including the
in-place mutation of the softmax weights and the fact that ``weight_softmax``
is computed but never used.
"""

import sys
from unittest import mock

import numpy as np
import torch
from django.test import SimpleTestCase

# ``service/tags/places365/places365.py`` does ``from places365 import wideresnet``,
# which normally resolves because ``service/tags`` is the cwd of the standalone
# service. Aliasing the real package under the top-level name (and importing
# ``wideresnet`` so the attribute exists) keeps this import working regardless
# of what other test modules left in ``sys.path``/``sys.modules``.
import service.tags.places365.wideresnet  # noqa: F401

sys.modules["places365"] = sys.modules["service.tags.places365"]

from service.tags.places365.places365 import Places365  # noqa: E402

MODULE = "service.tags.places365.places365"

# softmax([[10, 9, 1, 0, 0, 0]]) sorted descending:
#   ~0.73092, ~0.26889, ~9.02e-05, ~3.32e-05, ~3.32e-05, ~3.32e-05
LOGITS = torch.tensor([[10.0, 9.0, 1.0, 0.0, 0.0, 0.0]])

CLASSES = (
    "living_room",
    "beach/sunny",
    "sky-line",
    "kitchen",
    "office",
    "attic",
)

ATTRIBUTES = [
    "attr_zero",
    "attr_one",
    "attr_two",
    "attr_three",
    "attr_four",
    "attr_five",
    "attr_six",
    "attr_seven",
    "attr_eight",
    "attr_nine",
]


class FakeModel:
    """Minimal stand-in for the wideresnet model used by the inference."""

    def __init__(self, owner, logits=LOGITS, params=None):
        self.owner = owner
        self.logits = logits
        self.forward_calls = []
        if params is None:
            # params[-2] is the one read as the "softmax weight"; it deliberately
            # contains negatives so the in-place zeroing is observable.
            params = [
                torch.tensor([[1.0, 2.0]]),
                torch.tensor([[-1.0, 2.0], [3.0, -4.0]]),
                torch.tensor([[0.5]]),
            ]
        self._params = params

    def parameters(self):
        return iter(self._params)

    def forward(self, input_img):
        self.forward_calls.append(input_img)
        # The real model appends one blob per registered hook (layer4, avgpool).
        self.owner.features_blobs.append(np.zeros(3, dtype=np.float64))
        self.owner.features_blobs.append(np.array([1.0, 2.0, 3.0]))
        return self.logits


def make_instance(labels_io, model_factory=FakeModel):
    """A Places365 that behaves as if ``load()`` already ran."""
    p = Places365()
    p.labels_and_model_are_load = True
    p.classes = CLASSES
    p.labels_IO = np.array(labels_io)
    p.labels_attribute = list(ATTRIBUTES)
    # responses_attribute = W_attribute.dot(features_blobs[1]) with blob [1,2,3]
    # -> row i scores i, so argsort is simply 0..9 ascending.
    p.W_attribute = np.array(
        [[float(i), 0.0, 0.0] for i in range(len(ATTRIBUTES))], dtype=np.float64
    )
    p.model = model_factory(p)
    # Identity transform: the "image" is already a 1-D tensor.
    p.returnTF = lambda: lambda img: img
    return p


class InferencePlaces365Test(SimpleTestCase):
    def setUp(self):
        self.image = torch.zeros(3)
        patcher = mock.patch(f"{MODULE}.Image")
        self.image_mod = patcher.start()
        self.image_mod.open.return_value = self.image
        self.addCleanup(patcher.stop)

    def run_inference(self, instance, confidence=0.1, path="/fake/photo.jpg"):
        return instance.inference_places365(path, confidence)

    # ---------------------------------------------------------------- happy path

    def test_happy_path_returns_environment_categories_attributes(self):
        p = make_instance([0, 0, 0, 0, 0, 0])
        res = self.run_inference(p, confidence=0.1)

        self.assertEqual(
            sorted(res.keys()), ["attributes", "categories", "environment"]
        )
        self.assertEqual(res["environment"], "indoor")
        # Only the top two probabilities (0.73, 0.27) clear a 0.1 threshold.
        self.assertEqual(res["categories"], ["living room", "beach sunny"])
        # 9 attributes, highest response first (argsort is ascending, walked from -1).
        self.assertEqual(
            res["attributes"],
            [
                "attr nine",
                "attr eight",
                "attr seven",
                "attr six",
                "attr five",
                "attr four",
                "attr three",
                "attr two",
                "attr one",
            ],
        )
        self.assertEqual(len(res["attributes"]), 9)

    def test_image_is_opened_with_the_given_path_and_fed_to_the_model(self):
        p = make_instance([0, 0, 0, 0, 0, 0])
        self.run_inference(p, path="/photos/x.jpg")

        self.image_mod.open.assert_called_once_with("/photos/x.jpg")
        self.assertEqual(len(p.model.forward_calls), 1)
        # tf(img).unsqueeze(0) -> a leading batch dimension is added.
        self.assertEqual(tuple(p.model.forward_calls[0].shape), (1, 3))

    # ------------------------------------------------------------- environment

    def test_environment_outdoor_when_io_mean_above_half(self):
        p = make_instance([1, 1, 1, 1, 1, 0])
        self.assertEqual(self.run_inference(p)["environment"], "outdoor")

    def test_environment_outdoor_on_exact_half_boundary(self):
        # mean == 0.5 is NOT < 0.5, so the tie resolves to "outdoor".
        p = make_instance([0, 0, 0, 1, 1, 1])
        self.assertEqual(self.run_inference(p)["environment"], "outdoor")

    def test_environment_indoor_just_below_half(self):
        p = make_instance([0, 0, 0, 0, 1, 1])
        self.assertEqual(self.run_inference(p)["environment"], "indoor")

    # -------------------------------------------------------------- categories

    def test_confidence_above_top_probability_yields_no_categories(self):
        p = make_instance([0, 0, 0, 0, 0, 0])
        res = self.run_inference(p, confidence=0.9)
        self.assertEqual(res["categories"], [])
        # attributes are still produced even with zero categories
        self.assertEqual(len(res["attributes"]), 9)

    def test_zero_confidence_caps_categories_at_five(self):
        p = make_instance([0, 0, 0, 0, 0, 0])
        res = self.run_inference(p, confidence=0.0)
        self.assertEqual(
            res["categories"],
            ["living room", "beach sunny", "sky line", "kitchen", "office"],
        )

    def test_categories_break_on_first_below_threshold(self):
        # 0.73 passes, 0.27 fails -> the loop breaks, nothing further is checked.
        p = make_instance([0, 0, 0, 0, 0, 0])
        self.assertEqual(
            self.run_inference(p, confidence=0.5)["categories"], ["living room"]
        )

    def test_nan_probability_stops_the_category_walk(self):
        """A NaN probability is not "above" the threshold, so the loop breaks.

        Every comparison with NaN is False, so ``prob > confidence`` fails and
        the walk stops at that entry instead of emitting a bogus label.
        """
        # A NaN logit poisons the whole softmax, so every probability is NaN.
        nan_logits = torch.tensor([[10.0, float("nan"), 1.0, 0.0, 0.0, 0.0]])
        p = make_instance(
            [0, 0, 0, 0, 0, 0],
            model_factory=lambda owner: FakeModel(owner, logits=nan_logits),
        )
        res = self.run_inference(p, confidence=0.1)
        self.assertEqual(res["categories"], [])
        # the rest of the result is still produced
        self.assertEqual(len(res["attributes"]), 9)

    def test_category_names_have_underscore_slash_dash_replaced_by_spaces(self):
        p = make_instance([0, 0, 0, 0, 0, 0])
        res = self.run_inference(p, confidence=0.0)
        for name in res["categories"]:
            self.assertNotIn("_", name)
            self.assertNotIn("/", name)
            self.assertNotIn("-", name)

    # ------------------------------------------------------------------- state

    def test_load_is_called_when_labels_and_model_are_not_loaded(self):
        p = make_instance([0, 0, 0, 0, 0, 0])
        p.labels_and_model_are_load = False
        loaded = []

        def fake_load():
            loaded.append(True)
            # load() would normally flip the flag; the inference does not.
            p.labels_and_model_are_load = True

        p.load = fake_load
        self.run_inference(p)
        self.assertEqual(loaded, [True])

    def test_load_is_not_called_when_already_loaded(self):
        p = make_instance([0, 0, 0, 0, 0, 0])
        p.load = mock.Mock(side_effect=AssertionError("load() must not be called"))
        self.run_inference(p)

    def test_features_blobs_is_reset_on_every_call(self):
        p = make_instance([0, 0, 0, 0, 0, 0])
        p.features_blobs = ["stale"] * 5
        self.run_inference(p)
        # reset to [], then repopulated by the two forward hooks
        self.assertEqual(len(p.features_blobs), 2)

    def test_softmax_weights_are_zeroed_in_place_but_never_used(self):
        """Known wart: ``weight_softmax`` is dead, yet it mutates the model.

        ``params[-2].data.numpy()`` shares memory with the parameter tensor, so
        clamping the negatives writes straight back into the model's weights,
        and the resulting array is then discarded. Pinned as-is.
        """
        p = make_instance([0, 0, 0, 0, 0, 0])
        param = list(p.model.parameters())[-2]
        self.assertTrue((param.data.numpy() < 0).any())

        self.run_inference(p)

        mutated = list(p.model.parameters())[-2].data.numpy()
        np.testing.assert_array_equal(mutated, np.array([[0.0, 2.0], [3.0, 0.0]]))

    # ------------------------------------------------------------------ errors

    def test_image_open_failure_is_reraised_unchanged(self):
        p = make_instance([0, 0, 0, 0, 0, 0])
        boom = OSError("cannot identify image file")
        self.image_mod.open.side_effect = boom
        with mock.patch("builtins.print") as printed:
            with self.assertRaises(OSError) as ctx:
                self.run_inference(p)
        self.assertIs(ctx.exception, boom)
        printed.assert_called_once_with("tags: Error in Places365 inference")

    def test_model_forward_failure_is_reraised_unchanged(self):
        p = make_instance([0, 0, 0, 0, 0, 0])

        class ExplodingModel(FakeModel):
            def forward(self, input_img):
                raise RuntimeError("forward blew up")

        p.model = ExplodingModel(p)
        with mock.patch("builtins.print"):
            with self.assertRaises(RuntimeError) as ctx:
                self.run_inference(p)
        self.assertEqual(str(ctx.exception), "forward blew up")

    def test_missing_second_feature_blob_raises_index_error(self):
        """A model that fires only one hook fails late, after the categories."""
        p = make_instance([0, 0, 0, 0, 0, 0])

        class OneHookModel(FakeModel):
            def forward(self, input_img):
                self.owner.features_blobs.append(np.array([1.0, 2.0, 3.0]))
                return self.logits

        p.model = OneHookModel(p)
        with mock.patch("builtins.print"):
            with self.assertRaises(IndexError):
                self.run_inference(p)

    def test_load_failure_propagates(self):
        p = make_instance([0, 0, 0, 0, 0, 0])
        p.labels_and_model_are_load = False
        p.load = mock.Mock(side_effect=FileNotFoundError("no model file"))
        with mock.patch("builtins.print"):
            with self.assertRaises(FileNotFoundError):
                self.run_inference(p)


class RemoveNonspaceSeparatorsTest(SimpleTestCase):
    """Helper used by the inference to clean up label names."""

    def setUp(self):
        self.p = Places365()

    def test_underscore_slash_and_dash_become_spaces(self):
        self.assertEqual(
            self.p.remove_nonspace_separators("a_b/c-d"),
            "a b c d",
        )

    def test_plain_text_is_unchanged(self):
        self.assertEqual(self.p.remove_nonspace_separators("beach"), "beach")

    def test_existing_spaces_are_preserved(self):
        self.assertEqual(
            self.p.remove_nonspace_separators("living room"), "living room"
        )

    def test_repeated_separators_collapse_into_multiple_spaces(self):
        # split/join per separator, so "a__b" keeps both gaps as two spaces.
        self.assertEqual(self.p.remove_nonspace_separators("a__b"), "a  b")
