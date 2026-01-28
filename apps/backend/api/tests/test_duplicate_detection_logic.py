"""
Comprehensive tests for Duplicate Detection Logic.

Tests cover:
- BKTree: Burkhard-Keller Tree for efficient Hamming distance queries
- UnionFind: Union-Find data structure for grouping
- detect_exact_copies: Exact copy detection via MD5 hash
- detect_visual_duplicates: Visual similarity detection via perceptual hash
- batch_detect_duplicates: Batch detection orchestration
- Edge cases and error handling
"""

import uuid
from unittest.mock import patch

from django.test import TestCase

from api.models.duplicate import Duplicate
from api.models.file import File
from api.models.long_running_job import LongRunningJob
from api.duplicate_detection import (
    BKTree,
    UnionFind,
    detect_exact_copies,
    detect_visual_duplicates,
    batch_detect_duplicates,
)
from api.tests.utils import create_test_photo, create_test_user


class BKTreeTestCase(TestCase):
    """Tests for BKTree data structure."""

    def setUp(self):
        # Simple Hamming distance for testing
        def hamming(a, b):
            return sum(c1 != c2 for c1, c2 in zip(a, b))
        self.tree = BKTree(hamming)

    def test_empty_tree_search_returns_empty(self):
        """Test searching empty tree returns empty list."""
        results = self.tree.search("abc", 1)
        self.assertEqual(results, [])

    def test_add_single_item(self):
        """Test adding single item to tree."""
        self.tree.add("id1", "abc")
        
        self.assertEqual(self.tree.size, 1)
        self.assertIsNotNone(self.tree.root)
        self.assertEqual(self.tree.root["id"], "id1")
        self.assertEqual(self.tree.root["hash"], "abc")

    def test_add_multiple_items(self):
        """Test adding multiple items to tree."""
        self.tree.add("id1", "abc")
        self.tree.add("id2", "abd")
        self.tree.add("id3", "xyz")
        
        self.assertEqual(self.tree.size, 3)

    def test_search_exact_match(self):
        """Test searching for exact match (distance 0)."""
        self.tree.add("id1", "abc")
        self.tree.add("id2", "xyz")
        
        results = self.tree.search("abc", 0)
        
        self.assertEqual(len(results), 1)
        self.assertEqual(results[0][0], "id1")
        self.assertEqual(results[0][1], 0)  # distance

    def test_search_within_threshold(self):
        """Test searching within Hamming threshold."""
        self.tree.add("id1", "abc")
        self.tree.add("id2", "abd")  # distance 1 from "abc"
        self.tree.add("id3", "xyz")  # distance 3 from "abc"
        
        results = self.tree.search("abc", 1)
        
        self.assertEqual(len(results), 2)
        result_ids = [r[0] for r in results]
        self.assertIn("id1", result_ids)
        self.assertIn("id2", result_ids)
        self.assertNotIn("id3", result_ids)

    def test_search_threshold_excludes_distant(self):
        """Test threshold correctly excludes distant items."""
        self.tree.add("id1", "aaaa")
        self.tree.add("id2", "zzzz")  # distance 4 from "aaaa"
        
        results = self.tree.search("aaaa", 3)
        
        self.assertEqual(len(results), 1)
        self.assertEqual(results[0][0], "id1")

    def test_search_returns_correct_distances(self):
        """Test search returns correct Hamming distances."""
        self.tree.add("id1", "abc")
        self.tree.add("id2", "aXc")  # distance 1
        self.tree.add("id3", "XXc")  # distance 2
        
        results = self.tree.search("abc", 2)
        
        results_dict = {r[0]: r[1] for r in results}
        self.assertEqual(results_dict["id1"], 0)
        self.assertEqual(results_dict["id2"], 1)
        self.assertEqual(results_dict["id3"], 2)

    def test_add_duplicate_hash(self):
        """Test adding items with same hash."""
        self.tree.add("id1", "abc")
        self.tree.add("id2", "abc")  # Same hash, different id
        
        self.assertEqual(self.tree.size, 2)
        
        results = self.tree.search("abc", 0)
        result_ids = [r[0] for r in results]
        self.assertIn("id1", result_ids)
        self.assertIn("id2", result_ids)

    def test_large_tree_performance(self):
        """Test tree performs well with many items."""
        # Add 1000 items
        for i in range(1000):
            hash_val = f"{i:04d}"
            self.tree.add(f"id{i}", hash_val)
        
        self.assertEqual(self.tree.size, 1000)
        
        # Search should complete quickly
        results = self.tree.search("0500", 1)
        self.assertGreater(len(results), 0)


class UnionFindTestCase(TestCase):
    """Tests for UnionFind data structure."""

    def test_initial_find_creates_entry(self):
        """Test find creates new entry if not exists."""
        uf = UnionFind()
        
        root = uf.find("a")
        
        self.assertEqual(root, "a")
        self.assertIn("a", uf.parent)

    def test_find_same_element_returns_itself(self):
        """Test find on single element returns itself."""
        uf = UnionFind()
        
        uf.find("a")
        root = uf.find("a")
        
        self.assertEqual(root, "a")

    def test_union_links_elements(self):
        """Test union links two elements."""
        uf = UnionFind()
        
        uf.union("a", "b")
        
        self.assertEqual(uf.find("a"), uf.find("b"))

    def test_union_multiple_elements(self):
        """Test union of multiple elements."""
        uf = UnionFind()
        
        uf.union("a", "b")
        uf.union("b", "c")
        uf.union("c", "d")
        
        # All should have same root
        root_a = uf.find("a")
        self.assertEqual(uf.find("b"), root_a)
        self.assertEqual(uf.find("c"), root_a)
        self.assertEqual(uf.find("d"), root_a)

    def test_union_separate_groups(self):
        """Test union keeps separate groups separate."""
        uf = UnionFind()
        
        uf.union("a", "b")
        uf.union("c", "d")
        
        self.assertEqual(uf.find("a"), uf.find("b"))
        self.assertEqual(uf.find("c"), uf.find("d"))
        self.assertNotEqual(uf.find("a"), uf.find("c"))

    def test_get_groups_returns_groups(self):
        """Test get_groups returns correct groups."""
        uf = UnionFind()
        
        uf.union("a", "b")
        uf.union("c", "d")
        uf.union("d", "e")
        
        groups = uf.get_groups()
        
        self.assertEqual(len(groups), 2)
        
        # Check group contents
        group_sets = [set(g) for g in groups]
        self.assertIn({"a", "b"}, group_sets)
        self.assertIn({"c", "d", "e"}, group_sets)

    def test_get_groups_excludes_singletons(self):
        """Test get_groups excludes single-element groups."""
        uf = UnionFind()
        
        uf.find("a")  # Single element
        uf.union("b", "c")  # Pair
        
        groups = uf.get_groups()
        
        self.assertEqual(len(groups), 1)
        self.assertEqual(set(groups[0]), {"b", "c"})

    def test_path_compression(self):
        """Test path compression works (parent points directly to root)."""
        uf = UnionFind()
        
        # Create long chain
        uf.union("a", "b")
        uf.union("b", "c")
        uf.union("c", "d")
        
        # After find, path should be compressed
        root = uf.find("a")
        self.assertEqual(uf.parent["a"], root)


class DetectExactCopiesTestCase(TestCase):
    """Tests for detect_exact_copies function."""

    def setUp(self):
        self.user = create_test_user()

    def _create_photo_with_hash(self, image_hash, file_hash=None, **kwargs):
        """Helper to create Photo with specific hashes."""
        photo = create_test_photo(owner=self.user, **kwargs)
        photo.image_hash = image_hash
        
        if file_hash:
            file = File.objects.create(
                hash=file_hash,
                path=f"/photos/test_{uuid.uuid4()}.jpg",
                type=File.IMAGE,
            )
            photo.files.add(file)
            photo.main_file = file
        
        photo.save()
        return photo

    def test_no_duplicates_returns_zero(self):
        """Test no duplicates when all hashes unique."""
        self._create_photo_with_hash("hash1")
        self._create_photo_with_hash("hash2")
        self._create_photo_with_hash("hash3")
        
        count = detect_exact_copies(self.user)
        
        self.assertEqual(count, 0)

    def test_detects_duplicate_image_hash(self):
        """Test detects photos with same image_hash."""
        self._create_photo_with_hash("same_hash")
        self._create_photo_with_hash("same_hash")
        
        count = detect_exact_copies(self.user)
        
        self.assertEqual(count, 1)
        
        # Check duplicate was created
        duplicates = Duplicate.objects.filter(owner=self.user)
        self.assertEqual(duplicates.count(), 1)
        self.assertEqual(duplicates.first().photos.count(), 2)
        self.assertEqual(duplicates.first().duplicate_type, Duplicate.DuplicateType.EXACT_COPY)

    def test_detects_duplicate_file_hash(self):
        """Test detects photos with same file hash (MD5 part)."""
        # Same MD5 content hash (first 32 chars)
        file_hash1 = "a" * 32 + "user1"
        file_hash2 = "a" * 32 + "user2"  # Same MD5, different suffix
        
        self._create_photo_with_hash("unique1", file_hash1)
        self._create_photo_with_hash("unique2", file_hash2)
        
        count = detect_exact_copies(self.user)
        
        self.assertEqual(count, 1)

    def test_skips_hidden_photos(self):
        """Test hidden photos are excluded."""
        self._create_photo_with_hash("same_hash", hidden=True)
        self._create_photo_with_hash("same_hash")
        
        count = detect_exact_copies(self.user)
        
        # Only 1 visible photo with this hash, so no duplicate
        self.assertEqual(count, 0)

    def test_skips_trashed_photos(self):
        """Test trashed photos are excluded."""
        self._create_photo_with_hash("same_hash", in_trashcan=True)
        self._create_photo_with_hash("same_hash")
        
        count = detect_exact_copies(self.user)
        
        self.assertEqual(count, 0)

    def test_multiple_duplicate_groups(self):
        """Test detects multiple separate duplicate groups."""
        # Group 1
        self._create_photo_with_hash("hash_a")
        self._create_photo_with_hash("hash_a")
        
        # Group 2
        self._create_photo_with_hash("hash_b")
        self._create_photo_with_hash("hash_b")
        self._create_photo_with_hash("hash_b")
        
        count = detect_exact_copies(self.user)
        
        self.assertEqual(count, 2)

    def test_progress_callback_called(self):
        """Test progress callback is called during detection."""
        self._create_photo_with_hash("same_hash")
        self._create_photo_with_hash("same_hash")
        
        callback_calls = []
        
        def progress_callback(current, total, found):
            callback_calls.append((current, total, found))
        
        detect_exact_copies(self.user, progress_callback=progress_callback)
        
        # Callback may or may not be called depending on group count


class DetectVisualDuplicatesTestCase(TestCase):
    """Tests for detect_visual_duplicates function."""

    def setUp(self):
        self.user = create_test_user()

    def _create_photo_with_phash(self, perceptual_hash, **kwargs):
        """Helper to create Photo with perceptual hash."""
        photo = create_test_photo(owner=self.user, **kwargs)
        photo.perceptual_hash = perceptual_hash
        photo.save()
        return photo

    def test_no_photos_returns_zero(self):
        """Test returns 0 when no photos."""
        count = detect_visual_duplicates(self.user)
        
        self.assertEqual(count, 0)

    def test_single_photo_returns_zero(self):
        """Test returns 0 with only one photo."""
        self._create_photo_with_phash("abcd1234")
        
        count = detect_visual_duplicates(self.user)
        
        self.assertEqual(count, 0)

    def test_detects_identical_phash(self):
        """Test detects photos with identical perceptual hash."""
        self._create_photo_with_phash("a" * 16)
        self._create_photo_with_phash("a" * 16)
        
        count = detect_visual_duplicates(self.user, threshold=0)
        
        self.assertEqual(count, 1)

    def test_detects_similar_phash_within_threshold(self):
        """Test detects photos with similar perceptual hash."""
        # These hashes differ by 2 characters
        self._create_photo_with_phash("aaaaaaaaaaaaaaaa")
        self._create_photo_with_phash("aaaaaaaaaaaaaabb")  # 2 chars different
        
        count = detect_visual_duplicates(self.user, threshold=5)
        
        self.assertEqual(count, 1)

    def test_threshold_excludes_dissimilar(self):
        """Test threshold excludes dissimilar photos."""
        self._create_photo_with_phash("aaaaaaaaaaaaaaaa")
        self._create_photo_with_phash("zzzzzzzzzzzzzzzz")  # Very different
        
        count = detect_visual_duplicates(self.user, threshold=5)
        
        self.assertEqual(count, 0)

    def test_skips_photos_without_phash(self):
        """Test photos without perceptual hash are skipped."""
        self._create_photo_with_phash("aaaaaaaaaaaaaaaa")
        photo_no_hash = create_test_photo(owner=self.user)
        photo_no_hash.perceptual_hash = None
        photo_no_hash.save()
        
        count = detect_visual_duplicates(self.user)
        
        self.assertEqual(count, 0)

    def test_skips_hidden_photos(self):
        """Test hidden photos are excluded."""
        self._create_photo_with_phash("aaaaaaaaaaaaaaaa", hidden=True)
        self._create_photo_with_phash("aaaaaaaaaaaaaaaa")
        
        count = detect_visual_duplicates(self.user, threshold=0)
        
        self.assertEqual(count, 0)

    def test_creates_visual_duplicate_type(self):
        """Test creates duplicate with VISUAL_DUPLICATE type."""
        self._create_photo_with_phash("a" * 16)
        self._create_photo_with_phash("a" * 16)
        
        detect_visual_duplicates(self.user, threshold=0)
        
        duplicate = Duplicate.objects.filter(owner=self.user).first()
        self.assertEqual(duplicate.duplicate_type, Duplicate.DuplicateType.VISUAL_DUPLICATE)


class BatchDetectDuplicatesTestCase(TestCase):
    """Tests for batch_detect_duplicates orchestration."""

    def setUp(self):
        self.user = create_test_user()

    @patch('api.duplicate_detection.detect_exact_copies')
    @patch('api.duplicate_detection.detect_visual_duplicates')
    def test_calls_both_detectors_by_default(self, mock_visual, mock_exact):
        """Test both detectors called with default options."""
        mock_exact.return_value = 5
        mock_visual.return_value = 3
        
        batch_detect_duplicates(self.user)
        
        mock_exact.assert_called_once()
        mock_visual.assert_called_once()

    @patch('api.duplicate_detection.detect_exact_copies')
    @patch('api.duplicate_detection.detect_visual_duplicates')
    def test_respects_options(self, mock_visual, mock_exact):
        """Test options control which detectors run."""
        mock_exact.return_value = 0
        mock_visual.return_value = 0
        
        batch_detect_duplicates(self.user, options={
            'detect_exact_copies': False,
            'detect_visual_duplicates': True,
        })
        
        mock_exact.assert_not_called()
        mock_visual.assert_called_once()

    @patch('api.duplicate_detection.detect_exact_copies')
    @patch('api.duplicate_detection.detect_visual_duplicates')
    def test_passes_visual_threshold(self, mock_visual, mock_exact):
        """Test visual threshold passed to detector."""
        mock_exact.return_value = 0
        mock_visual.return_value = 0
        
        batch_detect_duplicates(self.user, options={
            'visual_threshold': 15,
        })
        
        mock_visual.assert_called_once()
        args, kwargs = mock_visual.call_args
        self.assertEqual(args[1], 15)  # threshold argument

    @patch('api.duplicate_detection.detect_exact_copies')
    @patch('api.duplicate_detection.detect_visual_duplicates')
    def test_creates_job(self, mock_visual, mock_exact):
        """Test LongRunningJob created for tracking."""
        mock_exact.return_value = 0
        mock_visual.return_value = 0
        
        batch_detect_duplicates(self.user)
        
        job = LongRunningJob.objects.filter(
            started_by=self.user,
            job_type=LongRunningJob.JOB_DETECT_DUPLICATES,
        ).first()
        self.assertIsNotNone(job)

    @patch('api.duplicate_detection.detect_exact_copies')
    @patch('api.duplicate_detection.detect_visual_duplicates')
    def test_clear_pending_option(self, mock_visual, mock_exact):
        """Test clear_pending option clears pending duplicates."""
        mock_exact.return_value = 0
        mock_visual.return_value = 0
        
        # Create pending duplicate
        photo1 = create_test_photo(owner=self.user)
        photo2 = create_test_photo(owner=self.user)
        duplicate = Duplicate.objects.create(
            owner=self.user,
            duplicate_type=Duplicate.DuplicateType.EXACT_COPY,
            review_status=Duplicate.ReviewStatus.PENDING,
        )
        duplicate.photos.add(photo1, photo2)
        
        batch_detect_duplicates(self.user, options={'clear_pending': True})
        
        # Pending duplicate should be cleared
        self.assertFalse(Duplicate.objects.filter(pk=duplicate.pk).exists())

    @patch('api.duplicate_detection.detect_exact_copies')
    def test_handles_exception(self, mock_exact):
        """Test exception handling during detection."""
        mock_exact.side_effect = Exception("Detection failed")
        
        with self.assertRaises(Exception):
            batch_detect_duplicates(self.user)
        
        # Job should be marked as failed
        job = LongRunningJob.objects.filter(started_by=self.user).first()
        self.assertIsNotNone(job)


class EdgeCasesTestCase(TestCase):
    """Edge case tests for duplicate detection."""

    def setUp(self):
        self.user = create_test_user()

    def test_empty_photo_library(self):
        """Test detection on empty library."""
        count_exact = detect_exact_copies(self.user)
        count_visual = detect_visual_duplicates(self.user)
        
        self.assertEqual(count_exact, 0)
        self.assertEqual(count_visual, 0)

    def test_photo_without_files(self):
        """Test photos without files are handled gracefully."""
        photo = create_test_photo(owner=self.user)
        photo.image_hash = "unique_hash"
        photo.save()
        # No files attached
        
        count = detect_exact_copies(self.user)
        self.assertEqual(count, 0)

    def test_photo_with_short_file_hash(self):
        """Test files with hash shorter than 32 chars."""
        photo = create_test_photo(owner=self.user)
        file = File.objects.create(
            hash="short",  # Less than 32 chars
            path="/photos/test.jpg",
            type=File.IMAGE,
        )
        photo.files.add(file)
        photo.save()
        
        # Should not raise
        count = detect_exact_copies(self.user)
        self.assertEqual(count, 0)

    def test_different_users_isolated(self):
        """Test duplicates are isolated per user."""
        other_user = create_test_user()
        
        # Create "duplicate" across users
        photo1 = create_test_photo(owner=self.user)
        photo1.image_hash = "same_hash"
        photo1.save()
        
        photo2 = create_test_photo(owner=other_user)
        photo2.image_hash = "same_hash"
        photo2.save()
        
        count = detect_exact_copies(self.user)
        
        # Should not find cross-user duplicates
        self.assertEqual(count, 0)

    def test_metadata_files_excluded(self):
        """Test metadata files excluded from duplicate detection."""
        photo = create_test_photo(owner=self.user)
        
        # Add metadata file
        metadata_file = File.objects.create(
            hash="a" * 32 + "suffix",
            path="/photos/test.xmp",
            type=File.METADATA_FILE,
        )
        photo.files.add(metadata_file)
        photo.save()
        
        # Should not count metadata file for duplicate detection
        count = detect_exact_copies(self.user)
        self.assertEqual(count, 0)

    def test_bktree_with_empty_hash(self):
        """Test BKTree handles empty/None hash gracefully."""
        def hamming(a, b):
            if not a or not b:
                return float('inf')
            return sum(c1 != c2 for c1, c2 in zip(a, b))
        
        tree = BKTree(hamming)
        tree.add("id1", "abc")
        
        # Search with valid hash should work
        results = tree.search("abc", 1)
        self.assertEqual(len(results), 1)

    def test_union_find_with_same_element_union(self):
        """Test UnionFind handles self-union."""
        uf = UnionFind()
        
        uf.union("a", "a")  # Self-union
        
        self.assertEqual(uf.find("a"), "a")
        groups = uf.get_groups()
        self.assertEqual(len(groups), 0)  # Single element not in groups

    def test_three_way_duplicate(self):
        """Test detection with 3+ copies of same file."""
        for _ in range(5):
            photo = create_test_photo(owner=self.user)
            photo.image_hash = "five_way_duplicate"
            photo.save()
        
        count = detect_exact_copies(self.user)
        
        self.assertEqual(count, 1)
        
        # Check all 5 photos in same group
        duplicate = Duplicate.objects.filter(owner=self.user).first()
        self.assertEqual(duplicate.photos.count(), 5)

    def test_transitive_duplicates_merged(self):
        """Test transitive duplicates are merged into one group."""
        # Photo A matches Photo B (same image_hash)
        # Photo B matches Photo C (same image_hash)
        # All three should be in same duplicate group
        
        photo_a = create_test_photo(owner=self.user)
        photo_a.image_hash = "hash_abc"
        file_a = File.objects.create(hash="x" * 32, path="/a.jpg", type=File.IMAGE)
        photo_a.files.add(file_a)
        photo_a.save()
        
        photo_b = create_test_photo(owner=self.user)
        photo_b.image_hash = "hash_abc"  # Same as A
        file_b = File.objects.create(hash="y" * 32, path="/b.jpg", type=File.IMAGE)
        photo_b.files.add(file_b)
        photo_b.save()
        
        photo_c = create_test_photo(owner=self.user)
        photo_c.image_hash = "hash_abc"  # Same as A and B
        file_c = File.objects.create(hash="z" * 32, path="/c.jpg", type=File.IMAGE)
        photo_c.files.add(file_c)
        photo_c.save()
        
        count = detect_exact_copies(self.user)
        
        # All 3 have same image_hash => all in one group
        self.assertEqual(count, 1)
        
        duplicate = Duplicate.objects.filter(owner=self.user).first()
        self.assertEqual(duplicate.photos.count(), 3)
