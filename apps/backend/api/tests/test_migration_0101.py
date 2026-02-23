"""
Test for migration 0101_populate_photo_metadata to ensure it works correctly.

This test verifies:
1. The fix for the PostgreSQL error: "operator does not exist: uuid = character varying"
2. The fix for the SQLite issue: cursor-during-writes conflict with iterator() + writes
"""
from importlib import import_module

from django.db import models
from django.db.models import Exists, OuterRef, Subquery
from django.test import TestCase

from api.models import Photo
from api.models.photo_caption import PhotoCaption
from api.models.photo_metadata import PhotoMetadata
from api.tests.utils import create_test_photo, create_test_user

_migration = import_module("api.migrations.0101_populate_photo_metadata")
BATCH_SIZE = _migration.BATCH_SIZE


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

    def test_batch_processing_without_iterator(self):
        """
        Test the fixed migration approach: fetch IDs upfront, process in batches.

        This tests the SQLite-compatible pattern where:
        - All photo IDs are collected first (no open cursor during writes)
        - Caption data is loaded per-batch
        - No iterator() is used alongside writes
        - Photos with pre-existing metadata are correctly excluded
        """
        photo1 = create_test_photo(
            owner=self.user,
            captions_json={"user_caption": "Batch photo 1", "keywords": ["a"]},
        )
        photo2 = create_test_photo(
            owner=self.user,
            captions_json={"user_caption": "Batch photo 2", "keywords": ["b", "c"]},
        )
        photo3 = create_test_photo(owner=self.user)  # no caption

        # photo_already_done has pre-existing metadata — should be excluded
        photo_already_done = create_test_photo(owner=self.user)
        PhotoMetadata.objects.filter(photo=photo_already_done).delete()
        existing_meta = PhotoMetadata.objects.create(
            photo=photo_already_done,
            caption="pre-existing",
            source="embedded",
            version=1,
        )

        PhotoMetadata.objects.filter(photo__in=[photo1, photo2, photo3]).delete()

        # --- Simulate the fixed migration approach ---
        existing_metadata = PhotoMetadata.objects.filter(photo_id=OuterRef('pk'))
        photo_ids = list(
            Photo.objects
            .filter(~Exists(existing_metadata))
            .values_list('pk', flat=True)
        )

        all_batch = []
        for chunk_start in range(0, len(photo_ids), BATCH_SIZE):
            chunk_ids = photo_ids[chunk_start:chunk_start + BATCH_SIZE]
            captions = {
                c.photo_id: c.captions_json
                for c in PhotoCaption.objects.filter(photo_id__in=chunk_ids)
            }
            batch = []
            for photo in Photo.objects.filter(pk__in=chunk_ids):
                captions_json = captions.get(photo.pk)
                batch.append(PhotoMetadata(
                    photo=photo,
                    caption=captions_json.get("user_caption") if captions_json else None,
                    keywords=list(captions_json.get("keywords", [])) if captions_json else [],
                    source="embedded",
                    version=1,
                ))
            PhotoMetadata.objects.bulk_create(batch, ignore_conflicts=True)
            all_batch.extend(batch)

        # All three photos must have metadata
        self.assertTrue(PhotoMetadata.objects.filter(photo=photo1).exists())
        self.assertTrue(PhotoMetadata.objects.filter(photo=photo2).exists())
        self.assertTrue(PhotoMetadata.objects.filter(photo=photo3).exists())

        m1 = PhotoMetadata.objects.get(photo=photo1)
        self.assertEqual(m1.caption, "Batch photo 1")
        self.assertEqual(m1.keywords, ["a"])

        m2 = PhotoMetadata.objects.get(photo=photo2)
        self.assertEqual(m2.caption, "Batch photo 2")
        self.assertEqual(m2.keywords, ["b", "c"])

        m3 = PhotoMetadata.objects.get(photo=photo3)
        self.assertIsNone(m3.caption)
        self.assertEqual(m3.keywords, [])

        # photo_already_done must NOT have been re-processed — exactly one record,
        # the pre-existing one, and its caption must still be the original value.
        self.assertEqual(PhotoMetadata.objects.filter(photo=photo_already_done).count(), 1)
        existing_meta.refresh_from_db()
        self.assertEqual(existing_meta.caption, "pre-existing")

    def test_batch_processing_is_idempotent(self):
        """
        Running the batch-based migration approach twice should not duplicate records.
        """
        photo = create_test_photo(
            owner=self.user,
            captions_json={"user_caption": "Idempotent test"},
        )
        PhotoMetadata.objects.filter(photo=photo).delete()

        def run_migration_logic():
            existing_metadata = PhotoMetadata.objects.filter(photo_id=OuterRef('pk'))
            photo_ids = list(
                Photo.objects
                .filter(~Exists(existing_metadata))
                .values_list('pk', flat=True)
            )
            captions = {
                c.photo_id: c.captions_json
                for c in PhotoCaption.objects.filter(photo_id__in=photo_ids)
            }
            batch = []
            for p in Photo.objects.filter(pk__in=photo_ids):
                captions_json = captions.get(p.pk)
                batch.append(PhotoMetadata(
                    photo=p,
                    caption=captions_json.get("user_caption") if captions_json else None,
                    keywords=list(captions_json.get("keywords", [])) if captions_json else [],
                    source="embedded",
                    version=1,
                ))
            PhotoMetadata.objects.bulk_create(batch, ignore_conflicts=True)

        run_migration_logic()
        self.assertEqual(PhotoMetadata.objects.filter(photo=photo).count(), 1)

        # Second run: the photo already has metadata, so it should be skipped
        run_migration_logic()
        self.assertEqual(PhotoMetadata.objects.filter(photo=photo).count(), 1)

    def test_bulk_create_ignore_conflicts_on_duplicate(self):
        """
        Verify that bulk_create(ignore_conflicts=True) silently skips duplicate records.

        This tests the safety net used in each batch: if for any reason a
        PhotoMetadata record already exists for a photo in the batch (e.g. a
        partially-applied migration is retried), the insert is ignored rather
        than raising an IntegrityError.
        """
        photo = create_test_photo(owner=self.user)
        PhotoMetadata.objects.filter(photo=photo).delete()

        first = PhotoMetadata(photo=photo, source="embedded", version=1)
        PhotoMetadata.objects.bulk_create([first], ignore_conflicts=True)
        self.assertEqual(PhotoMetadata.objects.filter(photo=photo).count(), 1)

        # Attempt to insert the same photo again — must not raise
        duplicate = PhotoMetadata(photo=photo, source="embedded", version=1)
        PhotoMetadata.objects.bulk_create([duplicate], ignore_conflicts=True)
        self.assertEqual(PhotoMetadata.objects.filter(photo=photo).count(), 1)
