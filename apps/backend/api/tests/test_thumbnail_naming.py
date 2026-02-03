"""
Tests for thumbnail naming using image_hash instead of UUID.
"""
import os
from unittest import mock
from django.test import TestCase
from django.conf import settings

from api.models import Photo, Thumbnail
from api.tests.utils import create_test_user, create_test_photo


class ThumbnailNamingTest(TestCase):
    """Test that thumbnails are named using image_hash instead of UUID"""

    def setUp(self):
        self.user = create_test_user()

    def test_thumbnail_uses_image_hash_not_uuid(self):
        """Verify that thumbnails use image_hash for file naming"""
        # Create a photo with thumbnail
        photo = create_test_photo(owner=self.user)
        
        # Verify photo has both UUID and image_hash
        self.assertIsNotNone(photo.id)  # UUID
        self.assertIsNotNone(photo.image_hash)  # Content hash
        self.assertNotEqual(str(photo.id), photo.image_hash)  # They should be different
        
        # Check that thumbnail exists
        self.assertTrue(hasattr(photo, 'thumbnail'))
        thumbnail = photo.thumbnail
        
        # Verify thumbnail paths use image_hash, not UUID
        self.assertIn(photo.image_hash, thumbnail.thumbnail_big.name)
        self.assertIn(photo.image_hash, thumbnail.square_thumbnail.name)
        self.assertIn(photo.image_hash, thumbnail.square_thumbnail_small.name)
        
        # Verify UUID is NOT in the thumbnail paths
        self.assertNotIn(str(photo.id), thumbnail.thumbnail_big.name)
        self.assertNotIn(str(photo.id), thumbnail.square_thumbnail.name)
        self.assertNotIn(str(photo.id), thumbnail.square_thumbnail_small.name)

    @mock.patch('api.models.thumbnail.create_thumbnail')
    @mock.patch('api.models.thumbnail.does_static_thumbnail_exist')
    def test_generate_thumbnail_uses_image_hash(self, mock_exists, mock_create):
        """Verify that _generate_thumbnail method uses image_hash"""
        # Mock to indicate thumbnails don't exist yet
        mock_exists.return_value = False
        mock_create.return_value = '/tmp/test.webp'
        
        # Create a photo
        photo = create_test_photo(owner=self.user)
        thumbnail = photo.thumbnail
        
        # Call _generate_thumbnail
        thumbnail._generate_thumbnail()
        
        # Verify create_thumbnail was called with image_hash, not UUID
        calls = mock_create.call_args_list
        for call in calls:
            kwargs = call[1]
            if 'hash' in kwargs:
                # The hash parameter should be the image_hash
                self.assertEqual(kwargs['hash'], photo.image_hash)
                # Should NOT be the UUID
                self.assertNotEqual(kwargs['hash'], str(photo.id))

    def test_thumbnail_file_naming_convention(self):
        """Test that thumbnail file names follow the correct pattern"""
        photo = create_test_photo(owner=self.user)
        thumbnail = photo.thumbnail
        
        # Check naming patterns
        expected_big = f"thumbnails_big/{photo.image_hash}.webp"
        expected_square = f"square_thumbnails/{photo.image_hash}.webp"
        expected_square_small = f"square_thumbnails_small/{photo.image_hash}.webp"
        
        self.assertEqual(thumbnail.thumbnail_big.name.strip(), expected_big)
        self.assertEqual(thumbnail.square_thumbnail.name.strip(), expected_square)
        self.assertEqual(thumbnail.square_thumbnail_small.name.strip(), expected_square_small)

    def test_video_thumbnail_naming(self):
        """Test that video thumbnails use .mp4 extension with image_hash"""
        photo = create_test_photo(owner=self.user, video=True)
        thumbnail = photo.thumbnail
        
        # Video thumbnails should use .mp4 for square thumbnails
        expected_big = f"thumbnails_big/{photo.image_hash}.webp"
        expected_square = f"square_thumbnails/{photo.image_hash}.mp4"
        expected_square_small = f"square_thumbnails_small/{photo.image_hash}.mp4"
        
        self.assertEqual(thumbnail.thumbnail_big.name.strip(), expected_big)
        self.assertEqual(thumbnail.square_thumbnail.name.strip(), expected_square)
        self.assertEqual(thumbnail.square_thumbnail_small.name.strip(), expected_square_small)
