"""The numpy pair search of visual duplicate detection against brute force."""

import random
from unittest.mock import patch

from django.test import SimpleTestCase

from api.duplicates import detection
from api.duplicates.detection import _similar_pairs_bktree, similar_pairs
from api.duplicates.perceptual_hash import hamming_distance


def _bit_distance(hash1, hash2):
    """Differing bits of two 64-bit hex hashes, one binary digit at a time."""
    bits1, bits2 = f"{int(hash1, 16):064b}", f"{int(hash2, 16):064b}"
    return sum(a != b for a, b in zip(bits1, bits2, strict=True))


def _brute_force(hashes, threshold):
    """Every pair, compared bit by bit."""
    return {
        (i, j)
        for i in range(len(hashes))
        for j in range(i + 1, len(hashes))
        if _bit_distance(hashes[i], hashes[j]) <= threshold
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
        with patch.object(detection, "_PAIR_BLOCK_ELEMENTS", 1):
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
    def test_agrees_with_a_bit_by_bit_count(self):
        hashes = _library(80, seed=3)
        for a, b in zip(hashes, hashes[1:]):
            self.assertEqual(hamming_distance(a, b), _bit_distance(a, b))

    def test_upper_case_and_invalid_input(self):
        self.assertEqual(hamming_distance("FFFFFFFFFFFFFFFF", "ffffffffffffffff"), 0)
        self.assertEqual(hamming_distance(None, "ffffffffffffffff"), 64)
        # Not 16 hex digits: read as imagehash's hex_to_hash did, a square of
        # isqrt(4 * len) bits a side. "0x" + 14 digits is 56 one bits in 64.
        odd = "0x" + "f" * 14
        self.assertEqual(hamming_distance(odd, "f" * 16), 8)
        # 9 digits: a 6 x 6 square (36 bits), zero-padded on the left.
        self.assertEqual(hamming_distance("00000000f", "00000000e"), 1)
        self.assertEqual(hamming_distance("00000000f", "f" * 9), 32)
        # Bits that do not fill whole rows, or squares of different sizes.
        self.assertEqual(hamming_distance("f" * 8, "f" * 8), 64)
        self.assertEqual(hamming_distance("f" * 4, "f" * 16), 64)
        self.assertEqual(hamming_distance("-f" * 8, "f" * 16), 64)
