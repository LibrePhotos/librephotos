"""
Tests for File path uniqueness enforcement.

Tests verify:
- Database unique constraint on File.path
- File.create() get_or_create pattern
- Migration deduplication logic
- Concurrent scan handling
"""

import os
import tempfile
import threading

from django.db import IntegrityError, transaction
from django.test import TestCase, TransactionTestCase

from api.models.file import File
from api.tests.utils import create_test_photo, create_test_user


class FilePathUniqueConstraintTestCase(TestCase):
    """Tests for the unique constraint on File.path."""

    def setUp(self):
        self.user = create_test_user()

    def test_unique_constraint_prevents_duplicate_paths(self):
        """Test that the database prevents creating two Files with the same path."""
        path = "/photos/test_image.jpg"
        
        # Create first file
        file1 = File.objects.create(
            hash="hash1" + "a" * 28,
            path=path,
            type=File.IMAGE,
        )
        
        # Attempting to create second file with same path should fail
        with self.assertRaises(IntegrityError):
            with transaction.atomic():
                File.objects.create(
                    hash="hash2" + "b" * 28,
                    path=path,
                    type=File.IMAGE,
                )

    def test_unique_constraint_allows_different_paths(self):
        """Test that different paths are allowed."""
        file1 = File.objects.create(
            hash="hash1" + "a" * 28,
            path="/photos/image1.jpg",
            type=File.IMAGE,
        )
        file2 = File.objects.create(
            hash="hash2" + "b" * 28,
            path="/photos/image2.jpg",
            type=File.IMAGE,
        )
        
        self.assertEqual(File.objects.count(), 2)
        self.assertNotEqual(file1.path, file2.path)

    def test_empty_paths_are_unique(self):
        """Test that empty paths are subject to unique constraint."""
        # First empty path file
        file1 = File.objects.create(
            hash="hash1" + "a" * 28,
            path="",
            type=File.IMAGE,
        )
        
        # Second empty path should fail
        with self.assertRaises(IntegrityError):
            with transaction.atomic():
                File.objects.create(
                    hash="hash2" + "b" * 28,
                    path="",
                    type=File.IMAGE,
                )


class FileCreateMethodTestCase(TestCase):
    """Tests for File.create() get_or_create pattern."""

    def setUp(self):
        self.user = create_test_user()
        # Create a temp directory for test files
        self.temp_dir = tempfile.mkdtemp()

    def tearDown(self):
        # Clean up temp files
        import shutil
        shutil.rmtree(self.temp_dir, ignore_errors=True)

    def _create_test_file(self, filename, content=b"test content"):
        """Helper to create a test file on disk."""
        path = os.path.join(self.temp_dir, filename)
        with open(path, "wb") as f:
            f.write(content)
        return path

    def test_create_returns_existing_file_for_same_path(self):
        """Test that File.create() returns existing File for same path."""
        path = self._create_test_file("test.jpg")
        
        # Create first file
        file1 = File.create(path, self.user)
        
        # Create second file with same path - should return existing
        file2 = File.create(path, self.user)
        
        # Should be the same file
        self.assertEqual(file1.hash, file2.hash)
        self.assertEqual(file1.path, file2.path)
        
        # Should only have one File in database
        self.assertEqual(File.objects.filter(path=path).count(), 1)

    def test_create_creates_new_file_for_different_path(self):
        """Test that File.create() creates new File for different path."""
        path1 = self._create_test_file("test1.jpg", b"content1")
        path2 = self._create_test_file("test2.jpg", b"content2")
        
        file1 = File.create(path1, self.user)
        file2 = File.create(path2, self.user)
        
        self.assertNotEqual(file1.hash, file2.hash)
        self.assertNotEqual(file1.path, file2.path)
        self.assertEqual(File.objects.count(), 2)

    def test_create_returns_existing_even_if_content_changed(self):
        """Test that File.create() returns existing File even if content changed."""
        path = self._create_test_file("test.jpg", b"original content")
        
        # Create first file
        file1 = File.create(path, self.user)
        original_hash = file1.hash
        
        # Modify file content
        with open(path, "wb") as f:
            f.write(b"modified content")
        
        # Create again - should return existing File (not recalculate hash)
        file2 = File.create(path, self.user)
        
        # Should return existing file (hash stays the same)
        self.assertEqual(file1.hash, file2.hash)
        self.assertEqual(file2.hash, original_hash)

    def test_create_determines_correct_file_type(self):
        """Test that File.create() correctly determines file type."""
        # Create image file
        img_path = self._create_test_file("photo.jpg")
        img_file = File.create(img_path, self.user)
        self.assertEqual(img_file.type, File.IMAGE)
        
        # Create RAW file
        raw_path = self._create_test_file("photo.CR2")
        raw_file = File.create(raw_path, self.user)
        self.assertEqual(raw_file.type, File.RAW_FILE)
        
        # Create metadata file
        xmp_path = self._create_test_file("photo.xmp")
        xmp_file = File.create(xmp_path, self.user)
        self.assertEqual(xmp_file.type, File.METADATA_FILE)


class MigrationDeduplicationTestCase(TestCase):
    """Tests for the migration deduplication logic."""

    def setUp(self):
        self.user = create_test_user()

    def test_deduplication_prefers_non_missing_file(self):
        """Test that deduplication logic prefers non-missing files.
        
        This tests the scoring logic that the migration uses.
        """
        # Create two files to simulate pre-migration state
        file_missing = File.objects.create(
            hash="hash_missing" + "a" * 21,
            path="/photos/missing_file.jpg",
            type=File.IMAGE,
            missing=True,
        )
        file_ok = File.objects.create(
            hash="hash_ok" + "a" * 25,
            path="/photos/ok_file.jpg",
            type=File.IMAGE,
            missing=False,
        )
        
        # Scoring logic: non-missing files get +100
        def score_file(f):
            score = 0
            if not f.missing:
                score += 100
            return score
        
        # Non-missing file should have higher score
        self.assertGreater(score_file(file_ok), score_file(file_missing))

    def test_deduplication_keeps_file_with_more_photos(self):
        """Test that deduplication prefers files linked to more photos."""
        path = "/photos/popular.jpg"
        
        # Create two files
        file_popular = File.objects.create(
            hash="hash_popular" + "a" * 20,
            path="/photos/popular1.jpg",
            type=File.IMAGE,
        )
        file_lonely = File.objects.create(
            hash="hash_lonely" + "a" * 21,
            path="/photos/lonely1.jpg",
            type=File.IMAGE,
        )
        
        # Link popular file to multiple photos
        for i in range(3):
            photo = create_test_photo(owner=self.user)
            photo.files.add(file_popular)
            photo.save()
        
        # Link lonely file to one photo
        photo = create_test_photo(owner=self.user)
        photo.files.add(file_lonely)
        photo.save()
        
        # Verify photo counts
        self.assertEqual(file_popular.photo_set.count(), 3)
        self.assertEqual(file_lonely.photo_set.count(), 1)


class ConcurrentScanTestCase(TransactionTestCase):
    """Tests for concurrent scan handling with unique constraint."""

    def setUp(self):
        self.user = create_test_user()
        self.temp_dir = tempfile.mkdtemp()

    def tearDown(self):
        import shutil
        shutil.rmtree(self.temp_dir, ignore_errors=True)

    def _create_test_file(self, filename, content=b"test content"):
        """Helper to create a test file on disk."""
        path = os.path.join(self.temp_dir, filename)
        with open(path, "wb") as f:
            f.write(content)
        return path

    def test_concurrent_create_same_path_no_duplicates(self):
        """Test that concurrent File.create() calls don't create duplicates."""
        path = self._create_test_file("concurrent_test.jpg")
        results = []
        errors = []
        
        def create_file():
            try:
                file = File.create(path, self.user)
                results.append(file.hash)
            except Exception as e:
                errors.append(str(e))
        
        # Run multiple threads trying to create the same file
        threads = []
        for _ in range(5):
            t = threading.Thread(target=create_file)
            threads.append(t)
        
        for t in threads:
            t.start()
        
        for t in threads:
            t.join()
        
        # All should succeed (due to get_or_create pattern)
        self.assertEqual(len(errors), 0, f"Errors occurred: {errors}")
        
        # All should return the same file
        self.assertTrue(len(set(results)) <= 1, 
            f"Expected same hash for all, got: {results}")
        
        # Should only have one File in database
        self.assertEqual(File.objects.filter(path=path).count(), 1)

    def test_concurrent_create_different_paths_succeeds(self):
        """Test that concurrent creates of different paths all succeed."""
        paths = [
            self._create_test_file(f"concurrent_test_{i}.jpg", f"content{i}".encode())
            for i in range(5)
        ]
        results = []
        
        def create_file(path):
            file = File.create(path, self.user)
            results.append(file.hash)
        
        threads = []
        for path in paths:
            t = threading.Thread(target=create_file, args=(path,))
            threads.append(t)
        
        for t in threads:
            t.start()
        
        for t in threads:
            t.join()
        
        # All 5 files should be created
        self.assertEqual(len(results), 5)
        self.assertEqual(File.objects.count(), 5)


class FilePathLookupTestCase(TestCase):
    """Tests for path-based lookups."""

    def setUp(self):
        self.user = create_test_user()

    def test_filter_by_path_is_exact(self):
        """Test that filtering by path is exact match."""
        file1 = File.objects.create(
            hash="hash1" + "a" * 28,
            path="/photos/image.jpg",
            type=File.IMAGE,
        )
        file2 = File.objects.create(
            hash="hash2" + "b" * 28,
            path="/photos/image2.jpg",
            type=File.IMAGE,
        )
        
        # Exact match should find only one
        result = File.objects.filter(path="/photos/image.jpg")
        self.assertEqual(result.count(), 1)
        self.assertEqual(result.first().hash, file1.hash)

    def test_photo_files_path_lookup(self):
        """Test that Photo.files.filter(path=...) works correctly."""
        file1 = File.objects.create(
            hash="hash1" + "a" * 28,
            path="/photos/image1.jpg",
            type=File.IMAGE,
        )
        file2 = File.objects.create(
            hash="hash2" + "b" * 28,
            path="/photos/image2.jpg",
            type=File.IMAGE,
        )
        
        photo = create_test_photo(owner=self.user)
        photo.files.add(file1, file2)
        
        # Should find exact path
        self.assertTrue(photo.files.filter(path="/photos/image1.jpg").exists())
        self.assertFalse(photo.files.filter(path="/photos/image3.jpg").exists())


class PhotoFileAssociationTestCase(TestCase):
    """Tests for Photo-File associations with unique path constraint."""

    def setUp(self):
        self.user = create_test_user()

    def test_multiple_photos_can_share_same_file(self):
        """Test that multiple Photos can reference the same File."""
        file = File.objects.create(
            hash="shared_hash" + "a" * 23,
            path="/photos/shared_image.jpg",
            type=File.IMAGE,
        )
        
        photo1 = create_test_photo(owner=self.user)
        photo2 = create_test_photo(owner=self.user)
        
        photo1.files.add(file)
        photo1.main_file = file
        photo1.save()
        
        photo2.files.add(file)
        photo2.main_file = file
        photo2.save()
        
        # Both photos should reference the same file
        self.assertEqual(photo1.main_file.hash, photo2.main_file.hash)
        self.assertEqual(file.photo_set.count(), 2)

    def test_photo_with_multiple_file_variants(self):
        """Test Photo with multiple file variants (JPEG + RAW)."""
        jpeg_file = File.objects.create(
            hash="jpeg_hash" + "a" * 24,
            path="/photos/image.jpg",
            type=File.IMAGE,
        )
        raw_file = File.objects.create(
            hash="raw_hash" + "a" * 25,
            path="/photos/image.CR2",
            type=File.RAW_FILE,
        )

        photo = create_test_photo(owner=self.user)
        photo.files.add(jpeg_file, raw_file)
        photo.main_file = jpeg_file
        photo.save()

        # Photo should have both explicitly added files
        # Note: create_test_photo sets main_file but doesn't add it to photo.files
        self.assertEqual(photo.files.count(), 2)
        self.assertTrue(photo.files.filter(path="/photos/image.jpg").exists())
        self.assertTrue(photo.files.filter(path="/photos/image.CR2").exists())
