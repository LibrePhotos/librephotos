"""
Test for XMP sidecar association with photos.

This test validates that XMP sidecar files are correctly associated with their
corresponding photos when processed in the correct order (images first, then metadata).
"""
import os
import random
import tempfile
from unittest.mock import patch

from django.test import TestCase

from api.directory_watcher import create_new_image
from api.models import Photo
from api.tests.utils import create_test_user


def create_unique_png(seed=0):
    """
    Create a minimal PNG with unique content based on seed value.
    Different seeds produce different hashes.
    """
    # Minimal PNG with variable pixel data to ensure unique hashes
    color = seed % 256
    return (
        b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01"
        b"\x08\x06\x00\x00\x00\x1f\x15\xc4\x89\x00\x00\x00\nIDATx\x9cc" + bytes([color]) + b"\x01"
        b"\x00\x00\x05\x00\x01\r\n-\xb4\x00\x00\x00\x00IEND\xaeB`\x82"
    )


class XMPAssociationTest(TestCase):
    """
    Test that metadata files (XMP sidecars) are correctly associated with photos.
    
    This test validates the core logic without async complexity by directly calling
    create_new_image for both images and metadata files.
    """

    def test_xmp_association_after_image_creation(self):
        """
        Test that XMP files are correctly associated when processed after their images.
        
        This test simulates the real scenario that the sentinel handles:
        - Files arrive in random mixed order from directory scanning
        - The sentinel logic separates them into images and metadata
        - Images are processed first, then metadata
        
        We verify that even when files are discovered in random order (e.g., XMP before image),
        the separation and ordering logic ensures correct association.
        """
        user = create_test_user()
        
        with tempfile.TemporaryDirectory() as tmpdir:
            N = 4
            all_files = []  # Mixed list simulating random directory scan order
            
            # Create test files with unique images
            for i in range(N):
                base = f"img_{i}"
                img_path = os.path.join(tmpdir, f"{base}.jpg")
                xmp_path = os.path.join(tmpdir, f"{base}.xmp")
                
                with open(img_path, "wb") as f:
                    f.write(create_unique_png(i))  # Each image has unique hash
                with open(xmp_path, "wb") as f:
                    f.write(b"<x:xmpmeta>test</x:xmpmeta>")
                
                # Add to mixed list (will be shuffled to simulate random discovery)
                all_files.append(('image', img_path))
                all_files.append(('xmp', xmp_path))
            
            # Shuffle to simulate random file system ordering
            # This is the key: files can be discovered in ANY order
            random.shuffle(all_files)
            
            # Example of what the shuffled order might look like:
            # [('xmp', '.../img_2.xmp'), ('image', '.../img_0.jpg'), ('xmp', '.../img_1.xmp'), ...]
            # This simulates the real problem: XMP files may be discovered before their images!
            
            # Separate into images and metadata (simulating what scan_photos does)
            from api.models.file import is_metadata
            image_paths = [path for ftype, path in all_files if not is_metadata(path)]
            xmp_paths = [path for ftype, path in all_files if is_metadata(path)]
            
            # Verify separation happened correctly
            self.assertEqual(len(image_paths), N, "Should have N images")
            self.assertEqual(len(xmp_paths), N, "Should have N XMP files")
            
            # Mock pyvips to accept our test images
            with patch("pyvips.Image.thumbnail"):
                # Process images first (simulating what the sentinel ensures)
                # This is the critical ordering that the sentinel guarantees
                for img_path in image_paths:
                    photo = create_new_image(user, img_path)
                    self.assertIsNotNone(photo, f"Photo should be created for {img_path}")
                
                # Then process XMP files (after sentinel waits for image group completion)
                for xmp_path in xmp_paths:
                    create_new_image(user, xmp_path)
            
            # Validate: all photos should have their XMP sidecars
            photos = list(Photo.objects.filter(owner=user))
            self.assertEqual(len(photos), N, "All images should produce Photo objects")
            
            for photo in photos:
                xmp_files = list(photo.files.filter(path__endswith=".xmp"))
                base = os.path.splitext(os.path.basename(photo.main_file.path))[0]
                self.assertEqual(
                    len(xmp_files), 1,
                    f"Photo {base} should have exactly 1 XMP sidecar, got {len(xmp_files)}"
                )

    def test_xmp_processed_before_image_fails_gracefully(self):
        """
        Test that XMP files processed before their images are handled gracefully.
        
        Without the sentinel ordering, this would be the problematic scenario.
        The XMP should not be associated (logged as warning) and later when the
        image is processed, it won't automatically pick up the orphaned XMP.
        """
        user = create_test_user()
        
        with tempfile.TemporaryDirectory() as tmpdir:
            img_path = os.path.join(tmpdir, "test_img.jpg")
            xmp_path = os.path.join(tmpdir, "test_img.xmp")
            
            with open(img_path, "wb") as f:
                f.write(create_unique_png(100))  # Use seed 100 for this test
            with open(xmp_path, "wb") as f:
                f.write(b"<x:xmpmeta>test</x:xmpmeta>")
            
            with patch("pyvips.Image.thumbnail"):
                # Process XMP first (the problematic order that sentinel prevents)
                result_xmp = create_new_image(user, xmp_path)
                self.assertIsNone(result_xmp, "XMP without photo should return None")
                
                # Now process the image
                photo = create_new_image(user, img_path)
                self.assertIsNotNone(photo, "Photo should be created")
                
                # The XMP won't be auto-associated (this is expected without rescan)
                xmp_files = list(photo.files.filter(path__endswith=".xmp"))
                self.assertEqual(
                    len(xmp_files), 0,
                    "XMP processed before image won't be auto-associated"
                )
    
    def test_metadata_function_finds_matching_photo(self):
        """
        Test that the metadata association logic in create_new_image correctly
        finds and associates with existing photos.
        """
        user = create_test_user()
        
        with tempfile.TemporaryDirectory() as tmpdir:
            img_path = os.path.join(tmpdir, "matching_test.jpg")
            xmp_path = os.path.join(tmpdir, "matching_test.xmp")
            
            with open(img_path, "wb") as f:
                f.write(create_unique_png(200))  # Use seed 200 for this test
            with open(xmp_path, "wb") as f:
                f.write(b"<x:xmpmeta>test matching</x:xmpmeta>")
            
            with patch("pyvips.Image.thumbnail"):
                # Create photo first
                photo = create_new_image(user, img_path)
                self.assertIsNotNone(photo, "Photo should be created")
                initial_file_count = photo.files.count()
                
                # Process XMP - should find and associate with photo
                create_new_image(user, xmp_path)
                
                # Refresh and verify
                photo.refresh_from_db()
                self.assertEqual(
                    photo.files.count(), initial_file_count + 1,
                    "XMP file should be added to photo"
                )
                
                xmp_file = photo.files.filter(path=xmp_path).first()
                self.assertIsNotNone(xmp_file, "XMP file should be associated with photo")
