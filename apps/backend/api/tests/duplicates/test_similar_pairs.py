"""The numpy pair search of visual duplicate detection against brute force."""

import random
from unittest.mock import patch

import imagehash
from django.test import SimpleTestCase

from api import duplicate_detection
from api.duplicate_detection import _similar_pairs_bktree, similar_pairs
from api.perceptual_hash import hamming_distance


def _brute_force(hashes, threshold):
    """Every pair, compared the way hamming_distance used to: through imagehash."""
    parsed = [imagehash.hex_to_hash(h) for h in hashes]
    return {
        (i, j)
        for i in range(len(hashes))
        for j in range(i + 1, len(hashes))
        if parsed[i] - parsed[j] <= threshold
    }


def _library(count, seed=7):
    """Random 64-bit hashes with near and exact copies planted in between."""
    rng = random.Random(seed)
    hashes = [f"{rng.getrandbits(64):016x}" for _ in range(count)]
    for i in range(0, count - 1, 9):
        flips = rng.sample(range(64), rng.randint(0, 14))
        value = int(hashes[i], 16)
        for bit in flips:
            value ^= 1 << bit
        hashes[i + 1] = f"{value:016x}"
    return hashes


class SimilarPairsTest(SimpleTestCase):
    def test_matches_brute_force_at_several_thresholds(self):
        hashes = _library(400)
        for threshold in (0, 4, 10, 20):
            with self.subTest(threshold=threshold):
                self.assertEqual(
                    set(similar_pairs(hashes, threshold)),
                    _brute_force(hashes, threshold),
                )

    def test_small_blocks_cover_every_pair(self):
        hashes = _library(150)
        # One row per step.
        with patch.object(duplicate_detection, "_PAIR_BLOCK_ELEMENTS", 1):
            pairs = similar_pairs(hashes, 10)
        self.assertEqual(set(pairs), _brute_force(hashes, 10))
        self.assertEqual(len(pairs), len(set(pairs)))

    def test_other_hash_lengths_fall_back_to_the_bk_tree(self):
        hashes = _library(60) + ["abc", "0x" + "1" * 14]
        self.assertIsNone(similar_pairs(hashes, 10))
        pairs = set(_similar_pairs_bktree(hashes, 10))
        self.assertEqual(
            pairs,
            {
                (i, j)
                for i in range(len(hashes))
                for j in range(i + 1, len(hashes))
                if hamming_distance(hashes[i], hashes[j]) <= 10
            },
        )

    def test_no_hashes(self):
        self.assertEqual(similar_pairs([], 10), [])


class HammingDistanceFastPathTest(SimpleTestCase):
    def test_agrees_with_imagehash(self):
        hashes = _library(80, seed=3)
        for a, b in zip(hashes, hashes[1:]):
            self.assertEqual(
                hamming_distance(a, b),
                imagehash.hex_to_hash(a) - imagehash.hex_to_hash(b),
            )

    def test_upper_case_and_invalid_input(self):
        self.assertEqual(hamming_distance("FFFFFFFFFFFFFFFF", "ffffffffffffffff"), 0)
        self.assertEqual(hamming_distance(None, "ffffffffffffffff"), 64)
        # Not 16 hex digits: left to imagehash, as before.
        odd = "0x" + "f" * 14
        self.assertEqual(
            hamming_distance(odd, "f" * 16),
            imagehash.hex_to_hash(odd) - imagehash.hex_to_hash("f" * 16),
        )
