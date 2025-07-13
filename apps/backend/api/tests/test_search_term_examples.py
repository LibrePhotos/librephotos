from django.test import TestCase
from rest_framework.test import APIClient

from api.api_util import get_search_term_examples
from api.tests.utils import create_test_photo, create_test_user


class SearchTermExamplesTest(TestCase):
    def setUp(self):
        self.user = create_test_user()
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)

    def test_get_search_term_examples_with_captions(self):
        """Test that get_search_term_examples works after caption refactoring"""
        # Create a photo with captions and geolocation
        photo = create_test_photo(owner=self.user)

        # Add geolocation data to avoid the NoneType error
        photo.geolocation_json = {
            "features": [
                {"text": "New York"},
                {"text": "USA"},
                {"text": "North America"},
            ]
        }
        photo.save()

        # Add some caption data through the new PhotoCaption model
        from api.models.photo_caption import PhotoCaption

        caption_instance, created = PhotoCaption.objects.get_or_create(photo=photo)
        caption_instance.captions_json = {
            "places365": {
                "categories": ["outdoor", "nature"],
                "attributes": ["sunny", "green"],
            },
            "im2txt": "A beautiful landscape",
            "user_caption": "My vacation photo",
        }
        caption_instance.save()

        # This should not raise a FieldError
        search_terms = get_search_term_examples(self.user)

        # Should return some search terms
        self.assertIsInstance(search_terms, list)

    def test_get_search_term_examples_with_empty_captions(self):
        """Test that get_search_term_examples works with empty captions"""
        # Create a photo without captions
        photo = create_test_photo(owner=self.user)

        # Add geolocation data
        photo.geolocation_json = {
            "features": [
                {"text": "Miami"},
                {"text": "Florida"},
                {"text": "USA"},
            ]
        }
        photo.save()

        # Add empty caption data
        from api.models.photo_caption import PhotoCaption

        caption_instance, created = PhotoCaption.objects.get_or_create(photo=photo)
        caption_instance.captions_json = {
            "places365": {
                "categories": [],
                "attributes": [],
            },
            "im2txt": "",
            "user_caption": "",
        }
        caption_instance.save()

        # This should not raise a FieldError
        search_terms = get_search_term_examples(self.user)

        # Should return some search terms (may be empty)
        self.assertIsInstance(search_terms, list)

    def test_search_term_examples_api_endpoint(self):
        """Test the API endpoint that calls get_search_term_examples"""
        # Create a photo with captions and geolocation
        photo = create_test_photo(owner=self.user)

        # Add geolocation data
        photo.geolocation_json = {"features": [{"text": "Paris"}, {"text": "France"}]}
        photo.save()

        # Add some caption data
        from api.models.photo_caption import PhotoCaption

        caption_instance, created = PhotoCaption.objects.get_or_create(photo=photo)
        caption_instance.captions_json = {
            "places365": {"categories": ["outdoor"], "attributes": ["sunny"]}
        }
        caption_instance.save()

        # Test the API endpoint
        response = self.client.get("/api/searchtermexamples/")

        # Should not return 500 error
        self.assertEqual(response.status_code, 200)
        # The API returns a dict with 'results' key containing the list
        self.assertIn("results", response.data)
        self.assertIsInstance(response.data["results"], list)
