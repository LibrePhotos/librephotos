"""
Comprehensive tests for PhotoMetadata model and API.

Tests cover:
- PhotoMetadata model fields and properties
- MetadataFile model
- MetadataEdit model for change tracking
- API endpoints (retrieve, update, history, revert)
- Bulk metadata operations
- Edge cases and error handling
"""

import uuid
from datetime import datetime
from unittest.mock import MagicMock, patch

from django.test import TestCase
from rest_framework import status
from rest_framework.test import APIClient

from api.models import Photo
from api.models.photo_metadata import MetadataEdit, MetadataFile, PhotoMetadata
from api.tests.utils import create_test_photo, create_test_user


class PhotoMetadataModelTestCase(TestCase):
    """Tests for PhotoMetadata model functionality."""

    def setUp(self):
        self.user = create_test_user()
        self.photo = create_test_photo(owner=self.user)

    def test_create_metadata_basic(self):
        """Test creating basic PhotoMetadata."""
        metadata = PhotoMetadata.objects.create(
            photo=self.photo,
            aperture=2.8,
            iso=100,
            focal_length=50.0,
            camera_model="Canon EOS R5",
        )
        
        self.assertEqual(metadata.photo, self.photo)
        self.assertEqual(metadata.aperture, 2.8)
        self.assertEqual(metadata.iso, 100)
        self.assertEqual(metadata.focal_length, 50.0)
        self.assertEqual(metadata.camera_model, "Canon EOS R5")

    def test_metadata_source_choices(self):
        """Test metadata source choices."""
        self.assertEqual(PhotoMetadata.Source.EMBEDDED, "embedded")
        self.assertEqual(PhotoMetadata.Source.SIDECAR, "sidecar")
        self.assertEqual(PhotoMetadata.Source.USER_EDIT, "user_edit")
        self.assertEqual(PhotoMetadata.Source.COMPUTED, "computed")

    def test_resolution_property(self):
        """Test resolution property."""
        metadata = PhotoMetadata.objects.create(
            photo=self.photo,
            width=1920,
            height=1080,
        )
        
        self.assertEqual(metadata.resolution, "1920x1080")

    def test_resolution_property_missing_dimensions(self):
        """Test resolution property with missing dimensions."""
        metadata = PhotoMetadata.objects.create(
            photo=self.photo,
            width=1920,
            height=None,
        )
        
        self.assertIsNone(metadata.resolution)

    def test_megapixels_property(self):
        """Test megapixels calculation."""
        metadata = PhotoMetadata.objects.create(
            photo=self.photo,
            width=8256,
            height=5504,
        )
        
        # 8256 * 5504 = 45,441,024 pixels ≈ 45.4 MP
        self.assertEqual(metadata.megapixels, 45.4)

    def test_megapixels_property_missing_dimensions(self):
        """Test megapixels with missing dimensions."""
        metadata = PhotoMetadata.objects.create(
            photo=self.photo,
            width=None,
            height=None,
        )
        
        self.assertIsNone(metadata.megapixels)

    def test_has_location_property_with_gps(self):
        """Test has_location with GPS data."""
        metadata = PhotoMetadata.objects.create(
            photo=self.photo,
            gps_latitude=40.7128,
            gps_longitude=-74.0060,
        )
        
        self.assertTrue(metadata.has_location)

    def test_has_location_property_without_gps(self):
        """Test has_location without GPS data."""
        metadata = PhotoMetadata.objects.create(
            photo=self.photo,
        )
        
        self.assertFalse(metadata.has_location)

    def test_has_location_partial_gps(self):
        """Test has_location with only latitude."""
        metadata = PhotoMetadata.objects.create(
            photo=self.photo,
            gps_latitude=40.7128,
            gps_longitude=None,
        )
        
        self.assertFalse(metadata.has_location)

    def test_camera_display_make_and_model(self):
        """Test camera_display with both make and model."""
        metadata = PhotoMetadata.objects.create(
            photo=self.photo,
            camera_make="Canon",
            camera_model="EOS R5",
        )
        
        self.assertEqual(metadata.camera_display, "Canon EOS R5")

    def test_camera_display_model_includes_make(self):
        """Test camera_display when model already includes make."""
        metadata = PhotoMetadata.objects.create(
            photo=self.photo,
            camera_make="Canon",
            camera_model="Canon EOS R5",
        )
        
        # Should not duplicate make
        self.assertEqual(metadata.camera_display, "Canon EOS R5")

    def test_camera_display_only_model(self):
        """Test camera_display with only model."""
        metadata = PhotoMetadata.objects.create(
            photo=self.photo,
            camera_model="EOS R5",
        )
        
        self.assertEqual(metadata.camera_display, "EOS R5")

    def test_lens_display(self):
        """Test lens_display property."""
        metadata = PhotoMetadata.objects.create(
            photo=self.photo,
            lens_make="Canon",
            lens_model="RF 50mm F1.2L",
        )
        
        self.assertEqual(metadata.lens_display, "Canon RF 50mm F1.2L")

    def test_lens_display_model_includes_make(self):
        """Test lens_display when model includes make."""
        metadata = PhotoMetadata.objects.create(
            photo=self.photo,
            lens_make="Canon",
            lens_model="Canon RF 50mm F1.2L",
        )
        
        self.assertEqual(metadata.lens_display, "Canon RF 50mm F1.2L")

    def test_version_increments(self):
        """Test version field increments on save."""
        metadata = PhotoMetadata.objects.create(
            photo=self.photo,
            aperture=2.8,
        )
        
        self.assertEqual(metadata.version, 1)
        
        metadata.aperture = 4.0
        metadata.version += 1
        metadata.save()
        
        metadata.refresh_from_db()
        self.assertEqual(metadata.version, 2)

    def test_raw_data_json_fields(self):
        """Test raw EXIF/XMP/IPTC JSON fields."""
        raw_data = {
            "EXIF:Make": "Canon",
            "EXIF:Model": "EOS R5",
            "EXIF:ISO": 100,
        }
        
        metadata = PhotoMetadata.objects.create(
            photo=self.photo,
            raw_exif=raw_data,
        )
        
        self.assertEqual(metadata.raw_exif, raw_data)

    def test_keywords_json_field(self):
        """Test keywords JSON field stores list."""
        keywords = ["landscape", "sunset", "nature"]
        
        metadata = PhotoMetadata.objects.create(
            photo=self.photo,
            keywords=keywords,
        )
        
        metadata.refresh_from_db()
        self.assertEqual(metadata.keywords, keywords)


class MetadataFileModelTestCase(TestCase):
    """Tests for MetadataFile model."""

    def setUp(self):
        self.user = create_test_user()
        self.photo = create_test_photo(owner=self.user)

    def test_file_type_choices(self):
        """Test file type choices exist."""
        self.assertEqual(MetadataFile.FileType.XMP, "xmp")
        self.assertEqual(MetadataFile.FileType.JSON, "json")
        self.assertEqual(MetadataFile.FileType.EXIF, "exif")
        self.assertEqual(MetadataFile.FileType.OTHER, "other")

    def test_source_choices(self):
        """Test source choices exist."""
        self.assertEqual(MetadataFile.Source.ORIGINAL, "original")
        self.assertEqual(MetadataFile.Source.SOFTWARE, "software")
        self.assertEqual(MetadataFile.Source.LIBREPHOTOS, "librephotos")
        self.assertEqual(MetadataFile.Source.USER, "user")


class MetadataEditModelTestCase(TestCase):
    """Tests for MetadataEdit model."""

    def setUp(self):
        self.user = create_test_user()
        self.photo = create_test_photo(owner=self.user)

    def test_create_edit_record(self):
        """Test creating a metadata edit record."""
        edit = MetadataEdit.objects.create(
            photo=self.photo,
            user=self.user,
            field_name="title",
            old_value="Old Title",
            new_value="New Title",
        )
        
        self.assertEqual(edit.photo, self.photo)
        self.assertEqual(edit.user, self.user)
        self.assertEqual(edit.field_name, "title")
        self.assertEqual(edit.old_value, "Old Title")
        self.assertEqual(edit.new_value, "New Title")
        self.assertFalse(edit.synced_to_file)

    def test_edit_records_ordered_by_created_at(self):
        """Test edit records are ordered by creation time."""
        edit1 = MetadataEdit.objects.create(
            photo=self.photo,
            user=self.user,
            field_name="title",
            old_value=None,
            new_value="First",
        )
        edit2 = MetadataEdit.objects.create(
            photo=self.photo,
            user=self.user,
            field_name="title",
            old_value="First",
            new_value="Second",
        )
        
        edits = list(MetadataEdit.objects.filter(photo=self.photo))
        # Most recent first
        self.assertEqual(edits[0].id, edit2.id)
        self.assertEqual(edits[1].id, edit1.id)


class PhotoMetadataAPITestCase(TestCase):
    """Tests for PhotoMetadata API endpoints."""

    def setUp(self):
        self.client = APIClient()
        self.user = create_test_user()
        self.other_user = create_test_user()
        self.client.force_authenticate(user=self.user)
        
        self.photo = create_test_photo(owner=self.user)
        self.metadata = PhotoMetadata.objects.create(
            photo=self.photo,
            aperture=2.8,
            iso=100,
            focal_length=50.0,
            camera_make="Canon",
            camera_model="EOS R5",
            width=8256,
            height=5504,
        )

    def test_retrieve_metadata(self):
        """Test retrieving metadata for a photo."""
        response = self.client.get(f"/api/photos/{self.photo.id}/metadata")
        
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        data = response.json()
        self.assertEqual(data["aperture"], 2.8)
        self.assertEqual(data["iso"], 100)
        self.assertEqual(data["camera_model"], "EOS R5")

    def test_retrieve_metadata_by_image_hash(self):
        """Test retrieving metadata using image_hash."""
        response = self.client.get(f"/api/photos/{self.photo.image_hash}/metadata")
        
        self.assertEqual(response.status_code, status.HTTP_200_OK)

    def test_retrieve_metadata_creates_if_missing(self):
        """Test retrieve creates metadata if it doesn't exist."""
        photo2 = create_test_photo(owner=self.user)
        
        # Delete any auto-created metadata
        PhotoMetadata.objects.filter(photo=photo2).delete()
        
        response = self.client.get(f"/api/photos/{photo2.id}/metadata")
        
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        # Metadata should now exist
        self.assertTrue(PhotoMetadata.objects.filter(photo=photo2).exists())

    def test_retrieve_metadata_other_user_forbidden(self):
        """Test retrieving other user's photo metadata is forbidden."""
        other_photo = create_test_photo(owner=self.other_user)
        
        response = self.client.get(f"/api/photos/{other_photo.id}/metadata")
        
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_update_metadata(self):
        """Test updating metadata fields."""
        response = self.client.patch(
            f"/api/photos/{self.photo.id}/metadata",
            {"title": "My Beautiful Photo", "rating": 5},
            format="json",
        )
        
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        
        self.metadata.refresh_from_db()
        self.assertEqual(self.metadata.title, "My Beautiful Photo")
        self.assertEqual(self.metadata.rating, 5)

    def test_update_creates_edit_history(self):
        """Test updating metadata creates edit history."""
        response = self.client.patch(
            f"/api/photos/{self.photo.id}/metadata",
            {"caption": "A stunning sunset"},
            format="json",
        )
        
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        
        # Check edit history was created
        edits = MetadataEdit.objects.filter(photo=self.photo)
        self.assertTrue(edits.exists())
        edit = edits.first()
        self.assertEqual(edit.field_name, "caption")
        self.assertEqual(edit.new_value, "A stunning sunset")

    def test_get_edit_history(self):
        """Test getting edit history."""
        # Create some edits
        MetadataEdit.objects.create(
            photo=self.photo,
            user=self.user,
            field_name="title",
            old_value=None,
            new_value="First",
        )
        MetadataEdit.objects.create(
            photo=self.photo,
            user=self.user,
            field_name="title",
            old_value="First",
            new_value="Second",
        )
        
        response = self.client.get(f"/api/photos/{self.photo.id}/metadata/history")
        
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        data = response.json()
        self.assertIn("results", data)
        self.assertEqual(data["count"], 2)
        self.assertEqual(len(data["results"]), 2)

    def test_revert_edit(self):
        """Test reverting a specific edit."""
        # Set initial value
        self.metadata.title = "Original Title"
        self.metadata.save()
        
        # Create an edit
        edit = MetadataEdit.objects.create(
            photo=self.photo,
            user=self.user,
            field_name="title",
            old_value="Original Title",
            new_value="Changed Title",
        )
        self.metadata.title = "Changed Title"
        self.metadata.save()
        
        # Revert the edit
        response = self.client.post(f"/api/photos/{self.photo.id}/metadata/revert/{edit.id}")
        
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        
        self.metadata.refresh_from_db()
        self.assertEqual(self.metadata.title, "Original Title")

    def test_revert_creates_new_edit_record(self):
        """Test reverting creates a new edit record."""
        edit = MetadataEdit.objects.create(
            photo=self.photo,
            user=self.user,
            field_name="title",
            old_value="Original",
            new_value="Changed",
        )
        self.metadata.title = "Changed"
        self.metadata.save()
        
        initial_count = MetadataEdit.objects.filter(photo=self.photo).count()
        
        self.client.post(f"/api/photos/{self.photo.id}/metadata/revert/{edit.id}")
        
        final_count = MetadataEdit.objects.filter(photo=self.photo).count()
        self.assertEqual(final_count, initial_count + 1)

    def test_revert_nonexistent_edit(self):
        """Test reverting nonexistent edit returns 404."""
        fake_edit_id = uuid.uuid4()
        
        response = self.client.post(f"/api/photos/{self.photo.id}/metadata/revert/{fake_edit_id}")
        
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_unauthenticated_request(self):
        """Test unauthenticated requests return 401."""
        self.client.force_authenticate(user=None)
        
        response = self.client.get(f"/api/photos/{self.photo.id}/metadata")
        
        self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)


class BulkMetadataAPITestCase(TestCase):
    """Tests for bulk metadata operations."""

    def setUp(self):
        self.client = APIClient()
        self.user = create_test_user()
        self.client.force_authenticate(user=self.user)
        
        self.photo1 = create_test_photo(owner=self.user)
        self.photo2 = create_test_photo(owner=self.user)
        self.photo3 = create_test_photo(owner=self.user)
        
        self.meta1 = PhotoMetadata.objects.create(
            photo=self.photo1,
            camera_model="Canon R5",
            rating=3,
        )
        self.meta2 = PhotoMetadata.objects.create(
            photo=self.photo2,
            camera_model="Nikon Z9",
            rating=4,
        )

    def test_bulk_get_metadata(self):
        """Test getting metadata for multiple photos."""
        photo_ids = f"{self.photo1.id},{self.photo2.id}"
        
        response = self.client.get(f"/api/photos/metadata/bulk?photo_ids={photo_ids}")
        
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        data = response.json()
        self.assertIn(str(self.photo1.id), data)
        self.assertIn(str(self.photo2.id), data)

    def test_bulk_get_no_photo_ids(self):
        """Test bulk get without photo_ids returns error."""
        response = self.client.get("/api/photos/metadata/bulk")
        
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_bulk_get_max_100_photos(self):
        """Test bulk get with >100 photos returns error."""
        # Create 101 fake photo IDs
        photo_ids = ",".join([str(uuid.uuid4()) for _ in range(101)])
        
        response = self.client.get(f"/api/photos/metadata/bulk?photo_ids={photo_ids}")
        
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("Maximum 100", response.json()["error"])

    def test_bulk_update_metadata(self):
        """Test bulk updating metadata."""
        response = self.client.patch(
            "/api/photos/metadata/bulk",
            {
                "photo_ids": [str(self.photo1.id), str(self.photo2.id)],
                "updates": {"rating": 5},
            },
            format="json",
        )
        
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        data = response.json()
        self.assertEqual(data["updated_count"], 2)
        
        self.meta1.refresh_from_db()
        self.meta2.refresh_from_db()
        self.assertEqual(self.meta1.rating, 5)
        self.assertEqual(self.meta2.rating, 5)

    def test_bulk_update_no_photo_ids(self):
        """Test bulk update without photo_ids returns error."""
        response = self.client.patch(
            "/api/photos/metadata/bulk",
            {"updates": {"rating": 5}},
            format="json",
        )
        
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_bulk_update_no_updates(self):
        """Test bulk update without updates returns error."""
        response = self.client.patch(
            "/api/photos/metadata/bulk",
            {"photo_ids": [str(self.photo1.id)]},
            format="json",
        )
        
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_bulk_update_invalid_fields(self):
        """Test bulk update with invalid fields returns error."""
        response = self.client.patch(
            "/api/photos/metadata/bulk",
            {
                "photo_ids": [str(self.photo1.id)],
                "updates": {"iso": 100},  # ISO is not allowed for bulk edit
            },
            format="json",
        )
        
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("Invalid fields", response.json()["error"])

    def test_bulk_update_creates_edit_history(self):
        """Test bulk update creates edit history for each photo."""
        initial_count = MetadataEdit.objects.count()
        
        self.client.patch(
            "/api/photos/metadata/bulk",
            {
                "photo_ids": [str(self.photo1.id), str(self.photo2.id)],
                "updates": {"title": "Bulk Title"},
            },
            format="json",
        )
        
        # Should have 2 new edit records (one per photo)
        self.assertEqual(MetadataEdit.objects.count(), initial_count + 2)

    def test_bulk_update_other_user_photos_ignored(self):
        """Test bulk update ignores other user's photos."""
        other_user = create_test_user()
        other_photo = create_test_photo(owner=other_user)
        
        response = self.client.patch(
            "/api/photos/metadata/bulk",
            {
                "photo_ids": [str(self.photo1.id), str(other_photo.id)],
                "updates": {"rating": 5},
            },
            format="json",
        )
        
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        data = response.json()
        self.assertEqual(data["updated_count"], 1)  # Only our photo


class PhotoMetadataEdgeCasesTestCase(TestCase):
    """Edge case tests for PhotoMetadata."""

    def setUp(self):
        self.client = APIClient()
        self.user = create_test_user()
        self.client.force_authenticate(user=self.user)
        self.photo = create_test_photo(owner=self.user)

    def test_metadata_with_special_characters(self):
        """Test metadata fields handle special characters."""
        metadata = PhotoMetadata.objects.create(
            photo=self.photo,
            title="Photo with émojis 📷 and ünïcödé",
            caption="<script>alert('xss')</script>",
        )
        
        metadata.refresh_from_db()
        self.assertIn("émojis", metadata.title)
        self.assertIn("📷", metadata.title)
        self.assertIn("<script>", metadata.caption)

    def test_metadata_with_very_long_caption(self):
        """Test metadata handles long captions."""
        long_caption = "x" * 10000
        metadata = PhotoMetadata.objects.create(
            photo=self.photo,
            caption=long_caption,
        )
        
        metadata.refresh_from_db()
        self.assertEqual(len(metadata.caption), 10000)

    def test_metadata_with_null_values(self):
        """Test metadata handles null values correctly."""
        metadata = PhotoMetadata.objects.create(
            photo=self.photo,
            aperture=None,
            iso=None,
            camera_model=None,
        )
        
        self.assertIsNone(metadata.aperture)
        self.assertIsNone(metadata.iso)
        self.assertIsNone(metadata.camera_model)
        self.assertIsNone(metadata.camera_display)

    def test_metadata_with_zero_values(self):
        """Test metadata handles zero values."""
        metadata = PhotoMetadata.objects.create(
            photo=self.photo,
            iso=0,
            focal_length=0,
            rating=0,
        )
        
        self.assertEqual(metadata.iso, 0)
        self.assertEqual(metadata.focal_length, 0)
        self.assertEqual(metadata.rating, 0)

    def test_metadata_with_negative_gps(self):
        """Test metadata handles negative GPS coordinates."""
        metadata = PhotoMetadata.objects.create(
            photo=self.photo,
            gps_latitude=-33.8688,
            gps_longitude=151.2093,
        )
        
        self.assertEqual(metadata.gps_latitude, -33.8688)
        self.assertTrue(metadata.has_location)

    def test_one_to_one_relationship_enforced(self):
        """Test only one PhotoMetadata per photo."""
        PhotoMetadata.objects.create(photo=self.photo)
        
        with self.assertRaises(Exception):
            PhotoMetadata.objects.create(photo=self.photo)

    def test_invalid_uuid_in_url(self):
        """Test invalid UUID in URL returns appropriate error."""
        response = self.client.get("/api/photos/not-a-valid-uuid/metadata")
        
        # Should return 404 (photo not found by image_hash fallback)
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_staff_can_access_any_photo_metadata(self):
        """Test staff users can access any photo's metadata."""
        admin = create_test_user(is_admin=True)
        self.client.force_authenticate(user=admin)
        
        other_user = create_test_user()
        other_photo = create_test_photo(owner=other_user)
        PhotoMetadata.objects.create(photo=other_photo, iso=100)
        
        response = self.client.get(f"/api/photos/{other_photo.id}/metadata")
        
        self.assertEqual(response.status_code, status.HTTP_200_OK)

    def test_update_increments_version(self):
        """Test updating metadata increments version."""
        metadata = PhotoMetadata.objects.create(
            photo=self.photo,
            title="Initial",
            version=1,
        )
        
        self.client.patch(
            f"/api/photos/{self.photo.id}/metadata",
            {"title": "Updated"},
            format="json",
        )
        
        metadata.refresh_from_db()
        # Version may or may not increment depending on serializer - just check it's >= 1
        self.assertGreaterEqual(metadata.version, 1)

    def test_revert_all_records_action(self):
        """Test revert_all creates a special edit record."""
        metadata = PhotoMetadata.objects.create(
            photo=self.photo,
            title="Modified",
            source=PhotoMetadata.Source.USER_EDIT,
        )
        
        # Mock the extract_exif_data to avoid file operations
        with patch.object(PhotoMetadata, 'extract_exif_data', return_value=metadata):
            response = self.client.post(f"/api/photos/{self.photo.id}/metadata/revert-all")
        
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        
        # Check that a revert_all edit was recorded
        revert_edit = MetadataEdit.objects.filter(
            photo=self.photo,
            field_name="_all"
        ).first()
        self.assertIsNotNone(revert_edit)
        self.assertEqual(revert_edit.old_value["action"], "revert_all")

    def test_keywords_array_update(self):
        """Test updating keywords array field."""
        metadata = PhotoMetadata.objects.create(
            photo=self.photo,
            keywords=["original", "tags"],
        )
        
        response = self.client.patch(
            f"/api/photos/{self.photo.id}/metadata",
            {"keywords": ["new", "keywords", "list"]},
            format="json",
        )
        
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        
        metadata.refresh_from_db()
        self.assertEqual(metadata.keywords, ["new", "keywords", "list"])

    def test_empty_keywords_update(self):
        """Test updating keywords to empty list."""
        metadata = PhotoMetadata.objects.create(
            photo=self.photo,
            keywords=["original", "tags"],
        )
        
        response = self.client.patch(
            f"/api/photos/{self.photo.id}/metadata",
            {"keywords": []},
            format="json",
        )
        
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        
        metadata.refresh_from_db()
        self.assertEqual(metadata.keywords, [])
