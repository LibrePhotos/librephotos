"""
Test for migration 0101_populate_photo_metadata to ensure it works correctly.

This test verifies the fix for the PostgreSQL error:
"operator does not exist: uuid = character varying"
"""
from django.test import TestCase
from django.db.models import OuterRef, Subquery

from api.models import Photo
from api.models.photo_caption import PhotoCaption
from api.models.photo_metadata import PhotoMetadata
from api.tests.utils import create_test_photo, create_test_user


class Migration0101TestCase(TestCase):
    """Test the migration logic for populating PhotoMetadata."""

    def setUp(self):
        """Set up test data."""
        self.user = create_test_user()

    def test_subquery_with_uuid_primary_key(self):
        """
        Test that the subquery correctly references the UUID primary key.
        
        This test ensures the fix for the PostgreSQL error where
        photo_id (UUID) was incorrectly compared with image_hash (VARCHAR).
        """
        # Create a photo with caption
        photo = create_test_photo(
            owner=self.user,
            captions_json={"user_caption": "Test caption", "keywords": ["test"]},
        )

        # Verify the caption was created
        self.assertTrue(PhotoCaption.objects.filter(photo=photo).exists())

        # Test the subquery pattern from the migration (FIXED version)
        caption_subquery = PhotoCaption.objects.filter(
            photo_id=OuterRef('pk')  # Using 'pk' (UUID) instead of 'image_hash' (VARCHAR)
        ).values('captions_json')[:1]

        # Query photos with the subquery annotation
        photos = Photo.objects.annotate(
            captions_data=Subquery(caption_subquery)
        ).filter(pk=photo.pk)

        # Verify the query works without PostgreSQL type errors
        self.assertEqual(photos.count(), 1)
        photo_with_caption = photos.first()
        self.assertIsNotNone(photo_with_caption.captions_data)
        self.assertEqual(
            photo_with_caption.captions_data.get("user_caption"),
            "Test caption"
        )

    def test_migration_logic_creates_metadata(self):
        """
        Test the full migration logic to ensure PhotoMetadata is populated.
        """
        # Create photos without metadata
        photo1 = create_test_photo(
            owner=self.user,
            captions_json={"user_caption": "First photo"},
        )
        photo2 = create_test_photo(
            owner=self.user,
            captions_json={"user_caption": "Second photo", "keywords": ["tag1", "tag2"]},
        )

        # Manually delete any metadata that might have been auto-created
        PhotoMetadata.objects.filter(photo__in=[photo1, photo2]).delete()

        # Verify no metadata exists
        self.assertFalse(PhotoMetadata.objects.filter(photo=photo1).exists())
        self.assertFalse(PhotoMetadata.objects.filter(photo=photo2).exists())

        # Simulate the migration logic
        caption_subquery = PhotoCaption.objects.filter(
            photo_id=OuterRef('pk')
        ).values('captions_json')[:1]

        existing_metadata = PhotoMetadata.objects.filter(photo_id=OuterRef('pk'))

        photos = Photo.objects.filter(
            ~models.Exists(existing_metadata)
        ).annotate(
            captions_data=Subquery(caption_subquery)
        )

        # Create PhotoMetadata for each photo
        for photo in photos:
            captions_json = photo.captions_data
            PhotoMetadata.objects.create(
                photo=photo,
                caption=captions_json.get("user_caption") if captions_json else None,
                keywords=list(captions_json.get("keywords", [])) if captions_json else [],
                source="embedded",
                version=1,
            )

        # Verify metadata was created
        self.assertTrue(PhotoMetadata.objects.filter(photo=photo1).exists())
        self.assertTrue(PhotoMetadata.objects.filter(photo=photo2).exists())

        # Verify caption data was correctly populated
        metadata1 = PhotoMetadata.objects.get(photo=photo1)
        self.assertEqual(metadata1.caption, "First photo")

        metadata2 = PhotoMetadata.objects.get(photo=photo2)
        self.assertEqual(metadata2.caption, "Second photo")
        self.assertEqual(metadata2.keywords, ["tag1", "tag2"])


# Import needed for the test
from django.db import models
