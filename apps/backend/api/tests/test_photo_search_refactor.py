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

        # Test setting search_location through property
        photo.search_location = "New York, USA"

        # Verify it was saved to PhotoSearch model
        self.assertEqual(photo.search_location, "New York, USA")
        self.assertEqual(photo.search_instance.search_location, "New York, USA")

    def test_search_captions_property_works(self):
        """Test that search_captions property works with the new PhotoSearch model"""
        photo = create_test_photo(owner=self.user)

        # Test setting search_captions through property
        photo.search_captions = "outdoor nature sunny"

        # Verify it was saved to PhotoSearch model
        self.assertEqual(photo.search_captions, "outdoor nature sunny")
        self.assertEqual(photo.search_instance.search_captions, "outdoor nature sunny")

    def test_recreate_search_captions_works(self):
        """Test that recreating search captions works with the new model structure"""
        photo = create_test_photo(owner=self.user)

        # Add some caption data
        caption_instance = photo._get_or_create_caption_instance()
        caption_instance.captions_json = {
            "places365": {"categories": ["outdoor"], "attributes": ["sunny"]},
            "user_caption": "My photo",
        }
        caption_instance.save()

        # Recreate search captions
        photo._recreate_search_captions()

        # Verify search captions were created
        self.assertIsNotNone(photo.search_captions)
        self.assertIn("outdoor", photo.search_captions)
        self.assertIn("sunny", photo.search_captions)
        self.assertIn("My photo", photo.search_captions)

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
        search_instance = photo._get_or_create_search_instance()
        search_instance.update_search_location(geolocation_data)
        search_instance.save()

        # Verify search_location was updated
        self.assertEqual(photo.search_location, "Central Park, New York, NY, USA")

    def test_search_instance_creation(self):
        """Test that PhotoSearch instance is created correctly"""
        photo = create_test_photo(owner=self.user)

        # Get or create search instance
        search_instance = photo._get_or_create_search_instance()

        # Verify it's linked correctly
        self.assertEqual(search_instance.photo, photo)
        self.assertEqual(photo.search_instance, search_instance)

    def test_api_compatibility(self):
        """Test that the API still works with the refactored models"""
        photo = create_test_photo(owner=self.user)

        # Set some search data
        photo.search_location = "Test Location"
        photo.search_captions = "test captions"

        # Test API endpoint
        response = self.client.get(f"/api/photos/{photo.image_hash}/")

        # Should not return 500 error
        self.assertEqual(response.status_code, 200)

        # Should include search data in response
        self.assertIn("search_location", response.data)
        self.assertIn("search_captions", response.data)
