from django.test import SimpleTestCase

from api.search.hybrid import FusionSettings, cut_semantic, fuse


class FuseTest(SimpleTestCase):
    def test_a_photo_high_on_both_lists_comes_first(self):
        ranked = fuse(["a", "b", "c"], ["c", "d", "a"], FusionSettings())
        self.assertEqual(ranked[:2], ["a", "c"])
        self.assertEqual(set(ranked), {"a", "b", "c", "d"})

    def test_equal_scores_keep_the_order_they_were_found_in(self):
        self.assertEqual(fuse(["a"], ["b"], FusionSettings()), ["a", "b"])

    def test_weights_tip_the_balance(self):
        settings = FusionSettings(semantic_weight=2.0)
        self.assertEqual(fuse(["a"], ["b"], settings), ["b", "a"])

    def test_one_list_alone(self):
        self.assertEqual(fuse([], ["x", "y"], FusionSettings()), ["x", "y"])


class CutSemanticTest(SimpleTestCase):
    def test_matches_below_the_floor_go(self):
        scored = [("a", 0.31), ("b", 0.16), ("c", 0.1)]
        self.assertEqual(cut_semantic(scored, 0.15), ["a", "b"])
