from django.test import TestCase
from rest_framework.test import APIClient

from api.tests.utils import create_test_photo, create_test_user


class PhotoSearchRefactorTest(TestCase):
    def setUp(self):
        self.user = create_test_user()
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)

    def test_search_location_property_works(self):
        """Test that search_location property works with the new PhotoSearch model"""
        photo = create_test_photo(owner=self.user)

        # Test setting search_location through direct access
        from api.models.photo_search import PhotoSearch

        search_instance, created = PhotoSearch.objects.get_or_create(photo=photo)
        search_instance.search_location = "New York, USA"
        search_instance.save()

        # Verify it was saved to PhotoSearch model
        self.assertEqual(search_instance.search_location, "New York, USA")
        self.assertEqual(photo.search_instance.search_location, "New York, USA")

    def test_search_captions_property_works(self):
        """Test that search_captions property works with the new PhotoSearch model"""
        photo = create_test_photo(owner=self.user)

        # Test setting search_captions through direct access
        from api.models.photo_search import PhotoSearch

        search_instance, created = PhotoSearch.objects.get_or_create(photo=photo)
        search_instance.search_captions = "outdoor nature sunny"
        search_instance.save()

        # Verify it was saved to PhotoSearch model
        self.assertEqual(search_instance.search_captions, "outdoor nature sunny")
        self.assertEqual(photo.search_instance.search_captions, "outdoor nature sunny")

    def test_recreate_search_captions_works(self):
        """Test that recreating search captions works with the new model structure"""
        photo = create_test_photo(owner=self.user)

        # Add some caption data
        from api.models.photo_caption import PhotoCaption
        from api.models.photo_search import PhotoSearch

        caption_instance, created = PhotoCaption.objects.get_or_create(photo=photo)
        caption_instance.captions_json = {
            "places365": {"categories": ["outdoor"], "attributes": ["sunny"]},
            "user_caption": "My photo",
        }
        caption_instance.save()

        # Recreate search captions
        search_instance, created = PhotoSearch.objects.get_or_create(photo=photo)
        search_instance.recreate_search_captions()
        search_instance.save()

        # Verify search captions were created
        from api.models.photo_search import PhotoSearch

        search_instance, created = PhotoSearch.objects.get_or_create(photo=photo)
        self.assertIsNotNone(search_instance.search_captions)
        self.assertIn("outdoor", search_instance.search_captions)
        self.assertIn("sunny", search_instance.search_captions)
        self.assertIn("My photo", search_instance.search_captions)

    def test_geolocate_updates_search_location(self):
        """Test that geolocating updates search_location through PhotoSearch"""
        photo = create_test_photo(owner=self.user)

        # Mock geolocation data
        geolocation_data = {
            "address": "Central Park, New York, NY, USA",
            "features": [
                {"text": "Central Park"},
                {"text": "New York"},
                {"text": "NY"},
                {"text": "USA"},
            ],
        }

        # Update search location through PhotoSearch
        from api.models.photo_search import PhotoSearch

        search_instance, created = PhotoSearch.objects.get_or_create(photo=photo)
        search_instance.update_search_location(geolocation_data)
        search_instance.save()

        # Verify search_location was updated
        self.assertEqual(
            search_instance.search_location, "Central Park, New York, NY, USA"
        )

    def test_direct_access_consistency(self):
        """Test that direct access to models maintains consistency"""
        photo = create_test_photo(owner=self.user)

        # Set data through direct access
        from api.models.photo_caption import PhotoCaption

        caption_instance, created = PhotoCaption.objects.get_or_create(photo=photo)
        caption_instance.captions_json = {"user_caption": "Test caption"}
        caption_instance.save()

        from api.models.photo_search import PhotoSearch

        search_instance, created = PhotoSearch.objects.get_or_create(photo=photo)
        search_instance.search_captions = "test captions"
        search_instance.search_location = "Test Location"
        search_instance.save()

        # Refresh photo to ensure data is loaded from database
        photo.refresh_from_db()

        # Verify data is accessible through direct access
        self.assertEqual(
            photo.caption_instance.captions_json["user_caption"], "Test caption"
        )
        self.assertEqual(photo.search_instance.search_captions, "test captions")
        self.assertEqual(photo.search_instance.search_location, "Test Location")
