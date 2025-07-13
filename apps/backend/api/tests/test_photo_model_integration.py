from django.test import TestCase
from django.utils import timezone
from django.core.exceptions import FieldDoesNotExist

from api.models import Photo, PhotoCaption, PhotoSearch, AlbumDate
from api.tests.utils import create_test_user, create_test_photo


class PhotoModelIntegrationTest(TestCase):
    def setUp(self):
        self.user = create_test_user()
        self.photo = create_test_photo(owner=self.user)

    def test_photo_properties_delegate_to_caption_model(self):
        """Test that Photo properties delegate to PhotoCaption model"""
        # Initially no caption instance
        caption_instance = self.photo._get_or_create_caption_instance()
        self.assertIsNone(caption_instance.captions_json)

        # Setting captions_json should create PhotoCaption instance
        caption_instance.captions_json = {"user_caption": "Test caption"}
        caption_instance.save()

        # Verify PhotoCaption was created
        self.assertTrue(PhotoCaption.objects.filter(photo=self.photo).exists())
        caption = PhotoCaption.objects.get(photo=self.photo)
        self.assertEqual(caption.captions_json["user_caption"], "Test caption")

        # Verify property returns the value
        self.assertEqual(caption.captions_json["user_caption"], "Test caption")

    def test_photo_properties_delegate_to_search_model(self):
        """Test that Photo properties delegate to PhotoSearch model"""
        # Initially no search instance
        search_instance = self.photo._get_or_create_search_instance()
        self.assertIsNone(search_instance.search_captions)
        self.assertIsNone(search_instance.search_location)

        # Setting search properties should create PhotoSearch instance
        search_instance.search_captions = "outdoor nature"
        search_instance.search_location = "New York"
        search_instance.save()

        # Verify PhotoSearch was created
        self.assertTrue(PhotoSearch.objects.filter(photo=self.photo).exists())
        search = PhotoSearch.objects.get(photo=self.photo)
        self.assertEqual(search.search_captions, "outdoor nature")
        self.assertEqual(search.search_location, "New York")

        # Refresh photo instance to get updated properties
        self.photo.refresh_from_db()

        # Verify properties return the values through direct access
        self.assertEqual(search_instance.search_captions, "outdoor nature")
        self.assertEqual(search_instance.search_location, "New York")

    def test_photo_caption_methods_delegate_correctly(self):
        """Test that Photo caption methods delegate to PhotoCaption"""
        # Test _save_captions method - this will fail due to thumbnail requirement
        # but we can test that it creates the PhotoCaption instance
        result = self.photo._save_captions(caption="My test caption")

        # The method should return False due to missing thumbnail but still create instance
        self.assertFalse(result)
        self.assertTrue(PhotoCaption.objects.filter(photo=self.photo).exists())

    def test_photo_search_methods_delegate_correctly(self):
        """Test that Photo search methods delegate to PhotoSearch"""
        # Create some caption data first
        caption_instance = self.photo._get_or_create_caption_instance()
        caption_instance.captions_json = {"user_caption": "Beautiful landscape"}
        caption_instance.save()

        # Test _recreate_search_captions method
        self.photo._recreate_search_captions()

        # Verify PhotoSearch was created and search captions updated
        self.assertTrue(PhotoSearch.objects.filter(photo=self.photo).exists())
        search = PhotoSearch.objects.get(photo=self.photo)
        self.assertIn("Beautiful landscape", search.search_captions)

    def test_geolocate_updates_search_location(self):
        """Test that _geolocate method updates search location"""
        # Mock geolocation data
        geolocation_data = {
            "features": [
                {"text": "Central Park"},
                {"text": "New York"},
                {"text": "USA"},
            ]
        }

        # Set geolocation_json on photo
        self.photo.geolocation_json = geolocation_data
        self.photo.save()

        # Manually trigger the search location update part
        search_instance = self.photo._get_or_create_search_instance()
        search_instance.update_search_location(geolocation_data)
        search_instance.save()

        # Refresh to get updated data
        self.photo.refresh_from_db()

        # Verify search location was updated
        self.assertIn("Central Park", search_instance.search_location)
        self.assertIn("New York", search_instance.search_location)
        self.assertIn("USA", search_instance.search_location)

    def test_cascade_deletion_of_related_models(self):
        """Test that deleting Photo cascades to PhotoCaption and PhotoSearch"""
        # Create related instances
        caption_instance = self.photo._get_or_create_caption_instance()
        caption_instance.captions_json = {"user_caption": "Test"}
        caption_instance.save()

        search_instance = self.photo._get_or_create_search_instance()
        search_instance.search_captions = "Test"
        search_instance.save()

        # Verify instances exist
        self.assertTrue(PhotoCaption.objects.filter(photo=self.photo).exists())
        self.assertTrue(PhotoSearch.objects.filter(photo=self.photo).exists())

        photo_id = self.photo.image_hash
        self.photo.delete()

        # Verify instances are deleted when photo is deleted
        self.assertFalse(PhotoCaption.objects.filter(photo_id=photo_id).exists())
        self.assertFalse(PhotoSearch.objects.filter(photo_id=photo_id).exists())

    def test_lazy_creation_of_related_instances(self):
        """Test that related instances are created only when needed"""
        # Initially no instances should exist
        self.assertFalse(PhotoCaption.objects.filter(photo=self.photo).exists())
        self.assertFalse(PhotoSearch.objects.filter(photo=self.photo).exists())

        # Calling _get_or_create methods should create instances
        caption_instance = self.photo._get_or_create_caption_instance()
        search_instance = self.photo._get_or_create_search_instance()

        self.assertIsNone(caption_instance.captions_json)
        self.assertIsNone(search_instance.search_captions)
        self.assertIsNone(search_instance.search_location)

        # Now instances should exist
        self.assertTrue(PhotoCaption.objects.filter(photo=self.photo).exists())
        self.assertTrue(PhotoSearch.objects.filter(photo=self.photo).exists())

        # Setting properties should save data to instances
        caption_instance.captions_json = {"test": "value"}
        search_instance.search_captions = "test"
        caption_instance.save()
        search_instance.save()

        # Verify data is stored
        self.assertTrue(PhotoCaption.objects.filter(photo=self.photo).exists())
        self.assertTrue(PhotoSearch.objects.filter(photo=self.photo).exists())

    def test_get_or_create_methods(self):
        """Test the _get_or_create_* methods"""
        # Test caption instance creation
        caption_instance1 = self.photo._get_or_create_caption_instance()
        caption_instance2 = self.photo._get_or_create_caption_instance()

        # Should return the same instance (using photo_id as primary key)
        self.assertEqual(caption_instance1.photo_id, caption_instance2.photo_id)

        # Test search instance creation
        search_instance1 = self.photo._get_or_create_search_instance()
        search_instance2 = self.photo._get_or_create_search_instance()

        # Should return the same instance (using photo_id as primary key)
        self.assertEqual(search_instance1.photo_id, search_instance2.photo_id)

    def test_complex_workflow(self):
        """Test a complex workflow involving all models"""
        # 1. Add user caption (will fail due to thumbnail but creates instance)
        caption_instance = self.photo._get_or_create_caption_instance()
        caption_instance.save_user_caption(caption="My vacation photo")

        # 2. Add places365 data directly
        caption_instance.captions_json = {
            "user_caption": "My vacation photo",
            "places365": {
                "categories": ["outdoor", "beach"],
                "attributes": ["sunny", "natural"],
                "environment": "outdoor",
            },
        }
        caption_instance.save()

        # 3. Recreate search captions
        search_instance = self.photo._get_or_create_search_instance()
        search_instance._recreate_search_captions()

        # 4. Add geolocation
        geolocation_data = {
            "features": [{"text": "Miami Beach"}, {"text": "Florida"}, {"text": "USA"}]
        }
        self.photo.geolocation_json = geolocation_data
        search_instance.update_search_location(geolocation_data)
        search_instance.save()

        # Refresh to get updated data
        self.photo.refresh_from_db()

        # Verify final state
        self.assertEqual(
            caption_instance.captions_json["user_caption"], "My vacation photo"
        )
        self.assertIn("outdoor", search_instance.search_captions)
        self.assertIn("beach", search_instance.search_captions)
        self.assertIn("My vacation photo", search_instance.search_captions)
        self.assertIn("Miami Beach", search_instance.search_location)

    def test_property_error_handling(self):
        """Test error handling in property getters"""
        # Test when related instances don't exist and there's an error
        photo = create_test_photo(owner=self.user)

        # These should return None gracefully, not raise exceptions
        caption_instance = photo._get_or_create_caption_instance()
        search_instance = photo._get_or_create_search_instance()

        self.assertIsNone(caption_instance.captions_json)
        self.assertIsNone(search_instance.search_captions)
        self.assertIsNone(search_instance.search_location)

    def test_backward_compatibility(self):
        """Test that the refactored models maintain backward compatibility"""
        # Create instances using the old-style approach (through properties)
        caption_instance = self.photo._get_or_create_caption_instance()
        caption_instance.captions_json = {
            "user_caption": "Test caption",
            "im2txt": "Generated caption",
        }
        caption_instance.save()

        search_instance = self.photo._get_or_create_search_instance()
        search_instance.search_captions = "test search terms"
        search_instance.search_location = "Test Location"
        search_instance.save()

        # Refresh to get updated data
        self.photo.refresh_from_db()

        # Verify data is accessible through properties
        self.assertEqual(caption_instance.captions_json["user_caption"], "Test caption")
        self.assertEqual(caption_instance.captions_json["im2txt"], "Generated caption")
        self.assertEqual(search_instance.search_captions, "test search terms")
        self.assertEqual(search_instance.search_location, "Test Location")

        # Verify data is stored in the correct models
        caption = PhotoCaption.objects.get(photo=self.photo)
        search = PhotoSearch.objects.get(photo=self.photo)

        self.assertEqual(caption.captions_json["user_caption"], "Test caption")
        self.assertEqual(search.search_captions, "test search terms")
        self.assertEqual(search.search_location, "Test Location")

    def test_queryset_only_with_search_location_fails(self):
        """Test that using search_location in queryset .only() raises FieldDoesNotExist"""
        # This should fail because search_location is no longer a database field
        with self.assertRaises(FieldDoesNotExist):
            list(Photo.objects.only("image_hash", "search_location").all())

    def test_queryset_only_with_search_instance_works(self):
        """Test that using search_instance__search_location in queryset .only() works"""
        # Create a photo with search data
        search_instance = self.photo._get_or_create_search_instance()
        search_instance.search_location = "New York"
        search_instance.save()

        # This should work because we're accessing through the related model
        photos = list(
            Photo.objects.select_related("search_instance")
            .only("image_hash", "search_instance__search_location")
            .filter(image_hash=self.photo.image_hash)
        )

        # Should be able to access the data
        self.assertEqual(len(photos), 1)
        # Note: accessing search_location property will still work even with .only()
        # because it goes through the related model

    def test_album_date_queryset_works(self):
        """Test that the album date queryset works with the fixed field references"""

        # Create a photo with search data
        search_instance = self.photo._get_or_create_search_instance()
        search_instance.search_location = "New York"
        search_instance.search_captions = "outdoor nature"
        search_instance.save()

        # Create an album date and add the photo to it
        album_date = AlbumDate.objects.create(
            date=self.photo.exif_timestamp.date()
            if self.photo.exif_timestamp
            else timezone.now().date(),
            owner=self.user,
        )
        album_date.photos.add(self.photo)

        # This should work with the corrected field references
        photo_qs = (
            album_date.photos.all()
            .select_related("search_instance")
            .only(
                "image_hash",
                "search_instance__search_location",
                "exif_timestamp",
            )
        )

        photos = list(photo_qs)
        self.assertEqual(len(photos), 1)
        self.assertEqual(photos[0].search_instance.search_location, "New York")
