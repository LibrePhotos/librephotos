"""
Test suite for SKIP_RAW_FILES feature.

Tests verify that:
1. walk_directory() skips RAW files during scanning when SKIP_RAW_FILES is enabled
2. walk_files() skips RAW files from file lists when SKIP_RAW_FILES is enabled
"""

import os
from django.test import TestCase
from django.utils import timezone
from pyfakefs.fake_filesystem_unittest import Patcher
from constance.test import override_config

from api.models import Photo, File
from api.models.file import is_raw, is_metadata
from api.directory_watcher import walk_directory, walk_files
from api.tests.utils import create_test_user


class SkipRawFilesDirectoryWatcherTest(TestCase):
    """Test suite for walk_directory() function with SKIP_RAW_FILES setting."""

    def setUp(self):
        """Set up test user for each test."""
        self.user = create_test_user()

    @override_config(SKIP_RAW_FILES=True)
    def test_walk_directory_skips_raw_files_when_enabled(self):
        """Test that walk_directory skips RAW files when SKIP_RAW_FILES is True."""
        with Patcher() as patcher:
            # Create a directory structure with mixed file types
            scan_dir = "/data/photos"
            patcher.fs.create_dir(scan_dir)
            
            # Create various file types
            jpg_path = os.path.join(scan_dir, "photo1.jpg")
            nef_path = os.path.join(scan_dir, "photo1.nef")
            xmp_path = os.path.join(scan_dir, "photo1.xmp")
            png_path = os.path.join(scan_dir, "photo2.png")
            
            patcher.fs.create_file(jpg_path, contents=b"jpg content")
            patcher.fs.create_file(nef_path, contents=b"nef content")
            patcher.fs.create_file(xmp_path, contents=b"xmp content")
            patcher.fs.create_file(png_path, contents=b"png content")

            # Walk the directory
            result = []
            walk_directory(scan_dir, result)
            
            # Extract just the filenames for easier assertion
            filenames = [os.path.basename(f) for f in result]
            
            # Verify RAW file is NOT in the list
            self.assertNotIn("photo1.nef", filenames)
            
            # Verify JPG, PNG, and XMP ARE in the list
            self.assertIn("photo1.jpg", filenames)
            self.assertIn("photo2.png", filenames)
            self.assertIn("photo1.xmp", filenames)

    @override_config(SKIP_RAW_FILES=False)
    def test_walk_directory_includes_raw_files_when_disabled(self):
        """Test that walk_directory includes RAW files when SKIP_RAW_FILES is False."""
        with Patcher() as patcher:
            # Create a directory structure with mixed file types
            scan_dir = "/data/photos2"
            patcher.fs.create_dir(scan_dir)
            
            # Create various file types
            jpg_path = os.path.join(scan_dir, "photo1.jpg")
            nef_path = os.path.join(scan_dir, "photo1.nef")
            
            patcher.fs.create_file(jpg_path, contents=b"jpg content")
            patcher.fs.create_file(nef_path, contents=b"nef content")

            # Walk the directory
            result = []
            walk_directory(scan_dir, result)
            
            # Extract just the filenames for easier assertion
            filenames = [os.path.basename(f) for f in result]
            
            # Verify RAW file IS in the list
            self.assertIn("photo1.nef", filenames)
            self.assertIn("photo1.jpg", filenames)


class SkipRawFilesWalkFilesTest(TestCase):
    """Test suite for walk_files() function with SKIP_RAW_FILES setting."""

    def setUp(self):
        """Set up test user for each test."""
        self.user = create_test_user()

    @override_config(SKIP_RAW_FILES=True)
    def test_walk_files_skips_raw_when_enabled(self):
        """Test that walk_files skips RAW files when SKIP_RAW_FILES is True."""
        with Patcher() as patcher:
            # Create files
            jpg_path = "/tmp/photo1.jpg"
            nef_path = "/tmp/photo1.nef"
            png_path = "/tmp/photo2.png"
            xmp_path = "/tmp/photo1.xmp"
            
            patcher.fs.create_file(jpg_path, contents=b"jpg content")
            patcher.fs.create_file(nef_path, contents=b"nef content")
            patcher.fs.create_file(png_path, contents=b"png content")
            patcher.fs.create_file(xmp_path, contents=b"xmp content")

            # Create list of files to scan
            scan_files = [jpg_path, nef_path, png_path, xmp_path]
            
            # Walk the files
            result = []
            walk_files(scan_files, result)
            
            # Extract just the filenames
            filenames = [os.path.basename(f) for f in result]
            
            # Verify RAW file is NOT in the list
            self.assertNotIn("photo1.nef", filenames)
            
            # Verify JPG, PNG, and XMP ARE in the list
            self.assertIn("photo1.jpg", filenames)
            self.assertIn("photo2.png", filenames)
            self.assertIn("photo1.xmp", filenames)

    @override_config(SKIP_RAW_FILES=False)
    def test_walk_files_includes_raw_when_disabled(self):
        """Test that walk_files includes RAW files when SKIP_RAW_FILES is False."""
        with Patcher() as patcher:
            # Create files
            jpg_path = "/tmp/photo3.jpg"
            nef_path = "/tmp/photo3.nef"
            
            patcher.fs.create_file(jpg_path, contents=b"jpg content")
            patcher.fs.create_file(nef_path, contents=b"nef content")

            # Create list of files to scan
            scan_files = [jpg_path, nef_path]
            
            # Walk the files
            result = []
            walk_files(scan_files, result)
            
            # Extract just the filenames
            filenames = [os.path.basename(f) for f in result]
            
            # Verify RAW file IS in the list
            self.assertIn("photo3.nef", filenames)
            self.assertIn("photo3.jpg", filenames)


class SkipRawFilesCleanupTest(TestCase):
    """Test suite for cleaning up existing RAW photos when SKIP_RAW_FILES is enabled."""

    def setUp(self):
        """Set up test user for each test."""
        self.user = create_test_user()

    @override_config(SKIP_RAW_FILES=True)
    def test_cleanup_removes_raw_photos_and_orphaned_metadata(self):
        """Test that existing RAW photos are removed and orphaned metadata files are cleaned up."""
        with Patcher() as patcher:
            # Scenario: User has scanned photos with RAW files before enabling SKIP_RAW_FILES
            # Now they enable the feature and run a rescan
            
            # Create filesystem with NEF that has XMP metadata
            nef_path = "/data/photos/img001.nef"
            xmp_path = "/data/photos/img001.xmp"
            
            patcher.fs.create_file(nef_path, contents=b"fake nef content")
            patcher.fs.create_file(xmp_path, contents=b"fake xmp content")

            # Simulate existing Photo with NEF file (as if scanned before SKIP_RAW_FILES was enabled)
            nef_file = File.create(nef_path, self.user)
            photo_raw = Photo.objects.create(
                image_hash=nef_file.hash,
                owner=self.user,
                main_file=nef_file,
                added_on=timezone.now()
            )
            photo_raw.files.add(nef_file)
            
            # Add XMP metadata file to the same photo
            xmp_file = File.create(xmp_path, self.user)
            photo_raw.files.add(xmp_file)
            photo_raw.save()

            # Verify photo exists with both files
            self.assertFalse(photo_raw.removed)
            self.assertEqual(photo_raw.files.count(), 2)
            self.assertEqual(photo_raw.main_file, nef_file)

            # Now user enables SKIP_RAW_FILES and triggers _check_files (happens during rescan)
            photo_raw._check_files()

            # Verify results
            photo_raw.refresh_from_db()
            
            # Photo should be marked as removed (only metadata remains)
            self.assertTrue(photo_raw.removed)
            
            # Main file should be cleared
            self.assertIsNone(photo_raw.main_file)
            
            # Only XMP should remain in files
            self.assertEqual(photo_raw.files.count(), 1)
            self.assertIn(xmp_file, photo_raw.files.all())
            self.assertNotIn(nef_file, photo_raw.files.all())
            
            # NEF file should be marked as missing
            nef_file.refresh_from_db()
            self.assertTrue(nef_file.missing)


class FileTypeDetectionTest(TestCase):
    """Test suite for file type detection functions (is_raw, is_metadata)."""

    def test_is_raw_detects_nef_files(self):
        """Test that is_raw correctly identifies NEF files."""
        self.assertTrue(is_raw("/path/to/photo.nef"))
        self.assertTrue(is_raw("/path/to/photo.NEF"))
        self.assertTrue(is_raw("PHOTO.NeF"))

    def test_is_raw_rejects_non_raw_files(self):
        """Test that is_raw returns False for non-RAW files."""
        self.assertFalse(is_raw("/path/to/photo.jpg"))
        self.assertFalse(is_raw("/path/to/photo.png"))
        self.assertFalse(is_raw("/path/to/photo.xmp"))

    def test_is_metadata_detects_xmp_files(self):
        """Test that is_metadata correctly identifies XMP files."""
        self.assertTrue(is_metadata("/path/to/photo.xmp"))
        self.assertTrue(is_metadata("/path/to/photo.XMP"))
        self.assertTrue(is_metadata("PHOTO.XmP"))

    def test_is_metadata_rejects_non_metadata_files(self):
        """Test that is_metadata returns False for non-metadata files."""
        self.assertFalse(is_metadata("/path/to/photo.jpg"))
        self.assertFalse(is_metadata("/path/to/photo.nef"))
        self.assertFalse(is_metadata("/path/to/photo.png"))
