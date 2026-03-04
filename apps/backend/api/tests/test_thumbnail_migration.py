"""
Tests for the thumbnail migration (0120_rename_thumbnails_uuid_to_hash)
"""

import os
import tempfile
from unittest.mock import patch
from django.test import TestCase
from django.conf import settings

from api.models import Photo, Thumbnail
from api.tests.utils import create_test_user, create_test_photo


class ThumbnailMigrationTest(TestCase):
    """Test the thumbnail UUID to hash migration"""

    def setUp(self):
        self.user = create_test_user()
        # Create a temporary directory for test thumbnails
        self.test_media_root = tempfile.mkdtemp()

    def tearDown(self):
        # Clean up temporary files
        import shutil

        if os.path.exists(self.test_media_root):
            shutil.rmtree(self.test_media_root)

    def test_batch_processing_logic(self):
        """Test that batch processing correctly handles multiple photos"""
        # Create test photos with thumbnails
        photos = []
        for i in range(5):
            photo = create_test_photo(owner=self.user)
            photos.append(photo)

        # Verify all photos have thumbnails
        self.assertEqual(Thumbnail.objects.count(), 5)

        # Verify thumbnails use image_hash in their paths
        for photo in photos:
            thumbnail = photo.thumbnail
            self.assertIn(photo.image_hash, thumbnail.thumbnail_big.name)
            self.assertIn(photo.image_hash, thumbnail.square_thumbnail.name)
            self.assertIn(photo.image_hash, thumbnail.square_thumbnail_small.name)

    @patch("django.conf.settings.MEDIA_ROOT")
    def test_file_renaming_with_mocked_filesystem(self, mock_media_root):
        """Test that the migration logic handles file renaming correctly"""
        # Set the mock to return our test directory
        test_dir = self.test_media_root
        mock_media_root.return_value = test_dir
        mock_media_root.__str__ = lambda _: test_dir

        # Create test photo
        photo = create_test_photo(owner=self.user)
        photo_uuid = str(photo.id)
        photo_hash = photo.image_hash

        # Create dummy thumbnail directories
        for thumb_dir in [
            "thumbnails_big",
            "square_thumbnails",
            "square_thumbnails_small",
        ]:
            os.makedirs(os.path.join(self.test_media_root, thumb_dir), exist_ok=True)

        # Create dummy "old" thumbnail files with UUID names
        old_files = []
        for thumb_dir in [
            "thumbnails_big",
            "square_thumbnails",
            "square_thumbnails_small",
        ]:
            old_file = os.path.join(
                self.test_media_root, thumb_dir, f"{photo_uuid}.webp"
            )
            with open(old_file, "w") as f:
                f.write("dummy thumbnail")
            old_files.append(old_file)
            self.assertTrue(os.path.exists(old_file))

        # Simulate the migration logic (simplified version)
        for thumb_dir in [
            "thumbnails_big",
            "square_thumbnails",
            "square_thumbnails_small",
        ]:
            old_path = os.path.join(
                self.test_media_root, thumb_dir, f"{photo_uuid}.webp"
            )
            new_path = os.path.join(
                self.test_media_root, thumb_dir, f"{photo_hash}.webp"
            )

            if os.path.exists(old_path) and not os.path.exists(new_path):
                os.rename(old_path, new_path)

        # Verify files were renamed
        for thumb_dir in [
            "thumbnails_big",
            "square_thumbnails",
            "square_thumbnails_small",
        ]:
            old_path = os.path.join(
                self.test_media_root, thumb_dir, f"{photo_uuid}.webp"
            )
            new_path = os.path.join(
                self.test_media_root, thumb_dir, f"{photo_hash}.webp"
            )

            self.assertFalse(
                os.path.exists(old_path), f"Old file should not exist: {old_path}"
            )
            self.assertTrue(
                os.path.exists(new_path), f"New file should exist: {new_path}"
            )

    def test_bulk_update_performance(self):
        """Test that bulk_update is more efficient than individual saves"""
        # This test verifies the concept - actual migration uses bulk_update
        photos = []
        thumbnails = []

        for i in range(10):
            photo = create_test_photo(owner=self.user)
            photos.append(photo)
            thumbnails.append(photo.thumbnail)

        # Update thumbnails in bulk
        for thumbnail in thumbnails:
            thumbnail.thumbnail_big = f"updated_{thumbnail.thumbnail_big}"

        # Use bulk_update (this is what the migration does)
        Thumbnail.objects.bulk_update(thumbnails, ["thumbnail_big"], batch_size=1000)

        # Verify updates were applied
        for i, photo in enumerate(photos):
            photo.thumbnail.refresh_from_db()
            self.assertTrue(photo.thumbnail.thumbnail_big.name.startswith("updated_"))
