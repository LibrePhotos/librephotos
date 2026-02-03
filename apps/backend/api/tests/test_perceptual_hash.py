"""
Comprehensive tests for api/perceptual_hash.py

Tests the perceptual hashing algorithm used for visual duplicate detection:
- calculate_perceptual_hash: Calculates pHash from image files
- calculate_hash_from_thumbnail: Wrapper for thumbnail hashing
- hamming_distance: Calculates bit difference between hashes
- are_duplicates: Determines if two images are duplicates based on hash similarity
- find_similar_hashes: Finds all similar hashes in a list
"""

import os
import tempfile
from unittest.mock import patch

from django.test import TestCase
from PIL import Image

from api.perceptual_hash import (
    DEFAULT_HAMMING_THRESHOLD,
    are_duplicates,
    calculate_hash_from_thumbnail,
    calculate_perceptual_hash,
    find_similar_hashes,
    hamming_distance,
)


class HammingDistanceTestCase(TestCase):
    """Tests for the hamming_distance function."""

    def test_identical_hashes_return_zero(self):
        """Identical hashes should have distance 0."""
        hash1 = "a" * 16  # 64-bit hash as 16 hex chars
        self.assertEqual(hamming_distance(hash1, hash1), 0)

    def test_completely_different_hashes(self):
        """Completely different hashes should have maximum distance (64 for 64-bit hash)."""
        # 0000...0000 vs FFFF...FFFF
        hash1 = "0" * 16
        hash2 = "f" * 16
        distance = hamming_distance(hash1, hash2)
        self.assertEqual(distance, 64)  # All 64 bits different

    def test_one_bit_difference(self):
        """Hashes differing by one bit should have distance 1."""
        # 0x0 = 0000 in binary, 0x1 = 0001 in binary - 1 bit different
        hash1 = "0" * 16
        hash2 = "0" * 15 + "1"
        distance = hamming_distance(hash1, hash2)
        self.assertEqual(distance, 1)

    def test_half_bits_different(self):
        """Test hashes with approximately half the bits different."""
        # 0 = 0000, a = 1010 - 2 bits different per hex char
        hash1 = "0" * 16
        hash2 = "a" * 16  # 2 bits per char * 16 chars = 32 bits
        distance = hamming_distance(hash1, hash2)
        self.assertEqual(distance, 32)

    def test_invalid_hash_returns_max_distance(self):
        """Invalid hash strings should return maximum distance (64)."""
        distance = hamming_distance("invalid", "hash")
        self.assertEqual(distance, 64)

    def test_empty_strings_return_max_distance(self):
        """Empty strings should return maximum distance."""
        distance = hamming_distance("", "")
        self.assertEqual(distance, 64)

    def test_mixed_valid_invalid_returns_max_distance(self):
        """Mix of valid and invalid should return max distance."""
        valid_hash = "a" * 16
        distance = hamming_distance(valid_hash, "not_hex_xyz")
        self.assertEqual(distance, 64)

    def test_different_length_hashes(self):
        """Different length hashes should return max distance or handle gracefully."""
        hash1 = "a" * 16
        hash2 = "a" * 8  # Shorter hash
        distance = hamming_distance(hash1, hash2)
        # imagehash may handle this differently - should not crash
        self.assertIsInstance(distance, int)

    def test_real_phash_values(self):
        """Test with realistic pHash values."""
        # These are example pHash values that might be generated
        hash1 = "8f94b5a16363c3c3"
        hash2 = "8f94b5a16363c3c7"  # 2 bits different (c3 vs c7)
        distance = hamming_distance(hash1, hash2)
        self.assertLessEqual(distance, 5)  # Should be small

    def test_case_insensitive_hashes(self):
        """Hash comparison should be case-insensitive (hex)."""
        hash1 = "ABCDEF0123456789"
        hash2 = "abcdef0123456789"
        distance = hamming_distance(hash1, hash2)
        self.assertEqual(distance, 0)


class AreDuplicatesTestCase(TestCase):
    """Tests for the are_duplicates function."""

    def test_identical_hashes_are_duplicates(self):
        """Identical hashes should always be considered duplicates."""
        hash1 = "a" * 16
        self.assertTrue(are_duplicates(hash1, hash1))

    def test_distance_under_threshold_is_duplicate(self):
        """Hashes with distance under threshold are duplicates."""
        # Using 1 bit difference which is well under default threshold of 10
        hash1 = "0" * 16
        hash2 = "0" * 15 + "1"
        self.assertTrue(are_duplicates(hash1, hash2))

    def test_distance_at_threshold_is_duplicate(self):
        """Hashes with distance exactly at threshold are duplicates."""
        with patch("api.perceptual_hash.hamming_distance", return_value=10):
            self.assertTrue(are_duplicates("a" * 16, "b" * 16, threshold=10))

    def test_distance_over_threshold_not_duplicate(self):
        """Hashes with distance over threshold are not duplicates."""
        with patch("api.perceptual_hash.hamming_distance", return_value=11):
            self.assertFalse(are_duplicates("a" * 16, "b" * 16, threshold=10))

    def test_empty_hash1_not_duplicate(self):
        """Empty first hash should not be considered duplicate."""
        self.assertFalse(are_duplicates("", "a" * 16))

    def test_empty_hash2_not_duplicate(self):
        """Empty second hash should not be considered duplicate."""
        self.assertFalse(are_duplicates("a" * 16, ""))

    def test_none_hash1_not_duplicate(self):
        """None first hash should not be considered duplicate."""
        self.assertFalse(are_duplicates(None, "a" * 16))

    def test_none_hash2_not_duplicate(self):
        """None second hash should not be considered duplicate."""
        self.assertFalse(are_duplicates("a" * 16, None))

    def test_both_none_not_duplicate(self):
        """Both None should not be considered duplicate."""
        self.assertFalse(are_duplicates(None, None))

    def test_both_empty_not_duplicate(self):
        """Both empty should not be considered duplicate."""
        self.assertFalse(are_duplicates("", ""))

    def test_custom_threshold_strict(self):
        """Strict threshold (lower) should reject more."""
        with patch("api.perceptual_hash.hamming_distance", return_value=5):
            self.assertTrue(are_duplicates("a" * 16, "b" * 16, threshold=5))
            self.assertFalse(are_duplicates("a" * 16, "b" * 16, threshold=4))

    def test_custom_threshold_loose(self):
        """Loose threshold (higher) should accept more."""
        with patch("api.perceptual_hash.hamming_distance", return_value=15):
            self.assertTrue(are_duplicates("a" * 16, "b" * 16, threshold=15))
            self.assertTrue(are_duplicates("a" * 16, "b" * 16, threshold=20))

    def test_default_threshold_value(self):
        """Default threshold should be 10."""
        self.assertEqual(DEFAULT_HAMMING_THRESHOLD, 10)


class FindSimilarHashesTestCase(TestCase):
    """Tests for the find_similar_hashes function."""

    def test_empty_target_hash_returns_empty(self):
        """Empty target hash should return empty list."""
        hash_list = [("img1", "a" * 16), ("img2", "b" * 16)]
        result = find_similar_hashes("", hash_list)
        self.assertEqual(result, [])

    def test_none_target_hash_returns_empty(self):
        """None target hash should return empty list."""
        hash_list = [("img1", "a" * 16), ("img2", "b" * 16)]
        result = find_similar_hashes(None, hash_list)
        self.assertEqual(result, [])

    def test_empty_hash_list_returns_empty(self):
        """Empty hash list should return empty list."""
        result = find_similar_hashes("a" * 16, [])
        self.assertEqual(result, [])

    def test_finds_similar_hashes(self):
        """Should find hashes within threshold."""
        target = "0" * 16
        # 1 bit different - should be found
        similar = "0" * 15 + "1"
        hash_list = [("img1", similar)]
        result = find_similar_hashes(target, hash_list)
        self.assertEqual(len(result), 1)
        self.assertEqual(result[0][0], "img1")
        self.assertEqual(result[0][1], 1)  # distance of 1

    def test_excludes_distant_hashes(self):
        """Should exclude hashes beyond threshold."""
        target = "0" * 16
        distant = "f" * 16  # 64 bits different
        hash_list = [("img1", distant)]
        result = find_similar_hashes(target, hash_list)
        self.assertEqual(result, [])

    def test_skips_identical_hash(self):
        """Should skip exact same hash (self-comparison)."""
        target = "a" * 16
        hash_list = [("img1", target)]  # Same hash
        result = find_similar_hashes(target, hash_list)
        self.assertEqual(result, [])

    def test_skips_none_hash_in_list(self):
        """Should skip None hashes in the list."""
        target = "a" * 16
        similar = "a" * 15 + "0"  # 1 bit different
        hash_list = [("img1", None), ("img2", similar)]
        result = find_similar_hashes(target, hash_list)
        self.assertEqual(len(result), 1)
        self.assertEqual(result[0][0], "img2")

    def test_skips_empty_hash_in_list(self):
        """Should skip empty hashes in the list."""
        target = "a" * 16
        similar = "a" * 15 + "0"
        hash_list = [("img1", ""), ("img2", similar)]
        result = find_similar_hashes(target, hash_list)
        self.assertEqual(len(result), 1)
        self.assertEqual(result[0][0], "img2")

    def test_sorted_by_distance(self):
        """Results should be sorted by distance (closest first)."""
        target = "0" * 16
        # Create hashes with known distances
        with patch("api.perceptual_hash.hamming_distance") as mock_dist:
            mock_dist.side_effect = [8, 3, 5]  # Distances for 3 hashes
            hash_list = [("img1", "h1"), ("img2", "h2"), ("img3", "h3")]
            result = find_similar_hashes(target, hash_list, threshold=10)
            # Should be sorted: img2 (3), img3 (5), img1 (8)
            self.assertEqual(result[0][0], "img2")
            self.assertEqual(result[1][0], "img3")
            self.assertEqual(result[2][0], "img1")

    def test_custom_threshold(self):
        """Should respect custom threshold."""
        target = "0" * 16
        with patch("api.perceptual_hash.hamming_distance") as mock_dist:
            mock_dist.return_value = 5
            hash_list = [("img1", "h1")]
            # Threshold 4 - should exclude distance 5
            result = find_similar_hashes(target, hash_list, threshold=4)
            self.assertEqual(result, [])
            # Threshold 5 - should include distance 5
            result = find_similar_hashes(target, hash_list, threshold=5)
            self.assertEqual(len(result), 1)

    def test_returns_correct_tuple_format(self):
        """Results should be (image_id, distance) tuples."""
        target = "0" * 16
        with patch("api.perceptual_hash.hamming_distance", return_value=2):
            hash_list = [("my_image_id", "some_hash")]
            result = find_similar_hashes(target, hash_list)
            self.assertEqual(len(result), 1)
            image_id, distance = result[0]
            self.assertEqual(image_id, "my_image_id")
            self.assertEqual(distance, 2)

    def test_multiple_similar_all_returned(self):
        """All similar hashes should be returned."""
        target = "0" * 16
        with patch("api.perceptual_hash.hamming_distance", return_value=5):
            hash_list = [("img1", "h1"), ("img2", "h2"), ("img3", "h3")]
            result = find_similar_hashes(target, hash_list, threshold=10)
            self.assertEqual(len(result), 3)


class CalculatePerceptualHashTestCase(TestCase):
    """Tests for the calculate_perceptual_hash function."""

    def setUp(self):
        """Create temporary directory for test images."""
        self.temp_dir = tempfile.mkdtemp()

    def tearDown(self):
        """Clean up temporary files."""
        import shutil

        shutil.rmtree(self.temp_dir, ignore_errors=True)

    def _create_test_image(self, filename, size=(100, 100), mode="RGB", color=(255, 0, 0)):
        """Helper to create a test image file."""
        path = os.path.join(self.temp_dir, filename)
        img = Image.new(mode, size, color)
        img.save(path)
        return path

    def test_valid_rgb_image(self):
        """Should calculate hash for valid RGB image."""
        path = self._create_test_image("test.jpg", mode="RGB")
        result = calculate_perceptual_hash(path)
        self.assertIsNotNone(result)
        self.assertIsInstance(result, str)
        self.assertEqual(len(result), 16)  # 64-bit hash = 16 hex chars

    def test_valid_rgba_image_converted(self):
        """Should handle RGBA images by converting to RGB."""
        path = self._create_test_image("test.png", mode="RGBA", color=(255, 0, 0, 128))
        result = calculate_perceptual_hash(path)
        self.assertIsNotNone(result)
        self.assertEqual(len(result), 16)

    def test_valid_grayscale_image(self):
        """Should handle grayscale (L mode) images."""
        path = self._create_test_image("test_gray.jpg", mode="L", color=128)
        result = calculate_perceptual_hash(path)
        self.assertIsNotNone(result)
        self.assertEqual(len(result), 16)

    def test_valid_palette_image_converted(self):
        """Should handle palette (P mode) images by converting to RGB."""
        path = os.path.join(self.temp_dir, "test_palette.png")
        img = Image.new("P", (100, 100))
        img.save(path)
        result = calculate_perceptual_hash(path)
        self.assertIsNotNone(result)

    def test_nonexistent_file_returns_none(self):
        """Should return None for nonexistent file."""
        result = calculate_perceptual_hash("/nonexistent/path/image.jpg")
        self.assertIsNone(result)

    def test_corrupted_file_returns_none(self):
        """Should return None for corrupted/invalid image file."""
        path = os.path.join(self.temp_dir, "corrupted.jpg")
        with open(path, "w") as f:
            f.write("not an image file content")
        result = calculate_perceptual_hash(path)
        self.assertIsNone(result)

    def test_empty_file_returns_none(self):
        """Should return None for empty file."""
        path = os.path.join(self.temp_dir, "empty.jpg")
        with open(path, "w") as _f:
            pass  # Create empty file
        result = calculate_perceptual_hash(path)
        self.assertIsNone(result)

    def test_directory_instead_of_file_returns_none(self):
        """Should return None if path is a directory."""
        result = calculate_perceptual_hash(self.temp_dir)
        self.assertIsNone(result)

    def test_custom_hash_size(self):
        """Should support custom hash sizes."""
        path = self._create_test_image("test.jpg")
        # hash_size=16 produces 256-bit hash = 64 hex chars
        result = calculate_perceptual_hash(path, hash_size=16)
        self.assertIsNotNone(result)
        self.assertEqual(len(result), 64)

    def test_small_hash_size(self):
        """Should support smaller hash sizes."""
        path = self._create_test_image("test.jpg")
        # hash_size=4 produces 16-bit hash = 4 hex chars
        result = calculate_perceptual_hash(path, hash_size=4)
        self.assertIsNotNone(result)
        self.assertEqual(len(result), 4)

    def test_similar_images_similar_hashes(self):
        """Similar images should produce similar hashes."""
        # Create two similar images (same color, slight size difference)
        path1 = self._create_test_image("img1.jpg", size=(100, 100), color=(255, 0, 0))
        path2 = self._create_test_image("img2.jpg", size=(110, 110), color=(255, 0, 0))
        hash1 = calculate_perceptual_hash(path1)
        hash2 = calculate_perceptual_hash(path2)
        self.assertIsNotNone(hash1)
        self.assertIsNotNone(hash2)
        # Similar solid color images should have low distance
        distance = hamming_distance(hash1, hash2)
        self.assertLessEqual(distance, 10)

    def test_different_images_different_hashes(self):
        """Very different images should produce different hashes."""
        # Create two very different images with patterns (not solid colors)
        # Solid colors produce similar hashes because pHash uses DCT
        path1 = os.path.join(self.temp_dir, "pattern1.jpg")
        path2 = os.path.join(self.temp_dir, "pattern2.jpg")

        # Create a horizontal gradient pattern
        img1 = Image.new("RGB", (100, 100))
        for x in range(100):
            for y in range(100):
                img1.putpixel((x, y), (x * 2, 0, 0))
        img1.save(path1)

        # Create a vertical gradient pattern (different structure)
        img2 = Image.new("RGB", (100, 100))
        for x in range(100):
            for y in range(100):
                img2.putpixel((x, y), (0, 0, y * 2))
        img2.save(path2)

        hash1 = calculate_perceptual_hash(path1)
        hash2 = calculate_perceptual_hash(path2)
        self.assertIsNotNone(hash1)
        self.assertIsNotNone(hash2)
        # Different patterns should have noticeable distance
        distance = hamming_distance(hash1, hash2)
        self.assertGreater(distance, 0)

    def test_deterministic_hash(self):
        """Same image should always produce same hash."""
        path = self._create_test_image("test.jpg")
        hash1 = calculate_perceptual_hash(path)
        hash2 = calculate_perceptual_hash(path)
        self.assertEqual(hash1, hash2)

    def test_very_small_image(self):
        """Should handle very small images (1x1 pixel)."""
        path = self._create_test_image("tiny.jpg", size=(1, 1))
        _result = calculate_perceptual_hash(path)
        # Should not crash - may return hash or None depending on implementation
        # The key is it doesn't raise an exception

    def test_very_large_image(self):
        """Should handle large images (though may be slow)."""
        path = self._create_test_image("large.jpg", size=(1000, 1000))
        result = calculate_perceptual_hash(path)
        self.assertIsNotNone(result)
        self.assertEqual(len(result), 16)

    def test_jpeg_vs_png_same_content(self):
        """Same image content in different formats should have similar hash."""
        # Create same color image in different formats
        jpg_path = self._create_test_image("test.jpg", color=(100, 150, 200))
        png_path = self._create_test_image("test.png", color=(100, 150, 200))
        hash_jpg = calculate_perceptual_hash(jpg_path)
        hash_png = calculate_perceptual_hash(png_path)
        self.assertIsNotNone(hash_jpg)
        self.assertIsNotNone(hash_png)
        distance = hamming_distance(hash_jpg, hash_png)
        # Same content should have identical or very similar hashes
        self.assertLessEqual(distance, 5)


class CalculateHashFromThumbnailTestCase(TestCase):
    """Tests for the calculate_hash_from_thumbnail function."""

    def setUp(self):
        """Create temporary directory for test images."""
        self.temp_dir = tempfile.mkdtemp()

    def tearDown(self):
        """Clean up temporary files."""
        import shutil

        shutil.rmtree(self.temp_dir, ignore_errors=True)

    def test_delegates_to_calculate_perceptual_hash(self):
        """Should delegate to calculate_perceptual_hash."""
        with patch("api.perceptual_hash.calculate_perceptual_hash") as mock:
            mock.return_value = "abc123"
            result = calculate_hash_from_thumbnail("/some/path")
            mock.assert_called_once_with("/some/path")
            self.assertEqual(result, "abc123")

    def test_returns_none_on_failure(self):
        """Should return None if underlying function fails."""
        result = calculate_hash_from_thumbnail("/nonexistent/path")
        self.assertIsNone(result)


class EdgeCasesTestCase(TestCase):
    """Edge case tests for the perceptual hash module."""

    def setUp(self):
        """Create temporary directory for test images."""
        self.temp_dir = tempfile.mkdtemp()

    def tearDown(self):
        """Clean up temporary files."""
        import shutil

        shutil.rmtree(self.temp_dir, ignore_errors=True)

    def test_unicode_filename(self):
        """Should handle unicode characters in filename."""
        path = os.path.join(self.temp_dir, "图片_照片_🖼️.jpg")
        img = Image.new("RGB", (50, 50), (255, 255, 0))
        img.save(path)
        result = calculate_perceptual_hash(path)
        self.assertIsNotNone(result)

    def test_special_characters_in_path(self):
        """Should handle special characters in file path."""
        path = os.path.join(self.temp_dir, "test with spaces & special (1).jpg")
        img = Image.new("RGB", (50, 50), (255, 255, 0))
        img.save(path)
        result = calculate_perceptual_hash(path)
        self.assertIsNotNone(result)

    def test_hash_only_contains_hex_chars(self):
        """Generated hash should only contain valid hex characters."""
        path = os.path.join(self.temp_dir, "test.jpg")
        img = Image.new("RGB", (50, 50), (123, 45, 67))
        img.save(path)
        result = calculate_perceptual_hash(path)
        self.assertIsNotNone(result)
        # Check all characters are hex
        valid_hex = set("0123456789abcdef")
        self.assertTrue(all(c in valid_hex for c in result.lower()))

    def test_webp_format(self):
        """Should handle WebP format images."""
        path = os.path.join(self.temp_dir, "test.webp")
        img = Image.new("RGB", (50, 50), (100, 100, 100))
        img.save(path, "WEBP")
        result = calculate_perceptual_hash(path)
        self.assertIsNotNone(result)

    def test_gif_format(self):
        """Should handle GIF format images."""
        path = os.path.join(self.temp_dir, "test.gif")
        img = Image.new("RGB", (50, 50), (50, 100, 150))
        img.save(path, "GIF")
        result = calculate_perceptual_hash(path)
        self.assertIsNotNone(result)

    def test_bmp_format(self):
        """Should handle BMP format images."""
        path = os.path.join(self.temp_dir, "test.bmp")
        img = Image.new("RGB", (50, 50), (200, 100, 50))
        img.save(path, "BMP")
        result = calculate_perceptual_hash(path)
        self.assertIsNotNone(result)

    def test_hamming_distance_with_newlines_in_hash(self):
        """Should handle hashes that might have whitespace (edge case)."""
        # This tests robustness - real hashes shouldn't have whitespace
        # imagehash's hex_to_hash is resilient and strips/ignores trailing chars
        distance = hamming_distance("a" * 16 + "\n", "a" * 16)
        # The library handles this gracefully - doesn't crash
        self.assertIsInstance(distance, int)

    def test_find_similar_with_large_list(self):
        """Should handle large hash lists efficiently."""
        target = "0" * 16
        # Create a large list of hashes
        hash_list = [(f"img_{i}", f"{i:016x}") for i in range(1000)]
        # Should not crash or hang
        result = find_similar_hashes(target, hash_list, threshold=10)
        self.assertIsInstance(result, list)

    def test_are_duplicates_with_whitespace_only_hash(self):
        """Should handle whitespace-only hash gracefully."""
        self.assertFalse(are_duplicates("   ", "a" * 16))
        self.assertFalse(are_duplicates("a" * 16, "   "))

    def test_cmyk_image_converted(self):
        """Should handle CMYK images by converting to RGB."""
        path = os.path.join(self.temp_dir, "test_cmyk.jpg")
        # Create a CMYK image
        img = Image.new("CMYK", (50, 50), (0, 100, 100, 0))  # Red in CMYK
        img.save(path)
        result = calculate_perceptual_hash(path)
        self.assertIsNotNone(result)

    def test_1bit_image(self):
        """Should handle 1-bit (black and white) images."""
        path = os.path.join(self.temp_dir, "test_1bit.png")
        img = Image.new("1", (50, 50), 1)  # White
        img.save(path)
        result = calculate_perceptual_hash(path)
        self.assertIsNotNone(result)

    def test_concurrent_hash_calculation(self):
        """Hash calculation should be thread-safe (no shared mutable state)."""
        import concurrent.futures

        # Create multiple test images with distinct patterns (not just solid colors)
        paths = []
        for i in range(5):
            path = os.path.join(self.temp_dir, f"concurrent_{i}.jpg")
            img = Image.new("RGB", (50, 50))
            # Create distinct patterns for each image
            for x in range(50):
                for y in range(50):
                    # Each image has a unique pattern based on i
                    if i == 0:
                        img.putpixel((x, y), (x * 5, 0, 0))  # Horizontal red gradient
                    elif i == 1:
                        img.putpixel((x, y), (0, y * 5, 0))  # Vertical green gradient
                    elif i == 2:
                        img.putpixel((x, y), (0, 0, (x + y) * 2))  # Diagonal blue
                    elif i == 3:
                        img.putpixel((x, y), ((x * y) % 256, 0, 0))  # Multiplicative pattern
                    else:
                        img.putpixel((x, y), (255 if x > 25 else 0, 255 if y > 25 else 0, 0))  # Quadrants
            img.save(path)
            paths.append(path)

        # Calculate hashes concurrently
        with concurrent.futures.ThreadPoolExecutor(max_workers=5) as executor:
            futures = [executor.submit(calculate_perceptual_hash, p) for p in paths]
            results = [f.result() for f in futures]

        # All should succeed
        self.assertTrue(all(r is not None for r in results))
        # Most should be unique (distinct patterns) - allow some similarity
        unique_count = len(set(results))
        self.assertGreaterEqual(unique_count, 3)  # At least 3 unique hashes from 5 distinct patterns


class PerformanceTestCase(TestCase):
    """Performance-related tests for the perceptual hash module."""

    def setUp(self):
        """Create temporary directory for test images."""
        self.temp_dir = tempfile.mkdtemp()

    def tearDown(self):
        """Clean up temporary files."""
        import shutil

        shutil.rmtree(self.temp_dir, ignore_errors=True)

    def test_hamming_distance_performance(self):
        """Hamming distance should be fast for many comparisons."""
        import time

        hash1 = "a" * 16
        hash2 = "b" * 16

        start = time.time()
        for _ in range(10000):
            hamming_distance(hash1, hash2)
        elapsed = time.time() - start

        # 10000 comparisons should complete in under 1 second
        self.assertLess(elapsed, 1.0)

    def test_find_similar_performance(self):
        """find_similar_hashes should be reasonably fast for medium-sized lists."""
        import time

        target = "0" * 16
        # Create a list of 100 hashes
        hash_list = [(f"img_{i}", f"{i:016x}") for i in range(100)]

        start = time.time()
        for _ in range(100):
            find_similar_hashes(target, hash_list, threshold=10)
        elapsed = time.time() - start

        # 100 searches over 100 hashes should complete quickly
        self.assertLess(elapsed, 2.0)
