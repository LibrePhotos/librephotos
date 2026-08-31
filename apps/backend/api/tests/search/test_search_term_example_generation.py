"""Tests for ``api.api_util.get_search_term_examples``.

``GetSearchTermExamples`` is the deterministic suite: ``random.random``/
``choice``/``choices``/``shuffle`` are stubbed in ``setUp`` so the exact set of
generated terms can be asserted for each ``random.random()`` value, plus the
no-photos fallback list.  ``SearchTermExamplesTest`` is the post-caption-refactor
smoke suite: it checks the helper (and the ``/api/searchtermexamples/`` endpoint)
still work now that captions live on ``PhotoCaption``.
"""

import random

from django.test import TestCase
from rest_framework.test import APIClient

from api.api_util import get_search_term_examples
from api.models import Photo
from api.tests.fixtures.api_util.captions_json import captions_json
from api.tests.fixtures.geocode.expectations.mapbox import expectations
from api.tests.utils import (
    create_test_photo,
    create_test_photos,
    create_test_photos_with_faces,
    create_test_user,
)


class GetSearchTermExamples(TestCase):
    def setUp(self) -> None:
        self.admin = create_test_user(is_admin=True)
        self.photos = (
            create_test_photos(
                90,
                owner=self.admin,
                geolocation_json=expectations[0],
                captions_json=captions_json,
                exif_timestamp="2017-08-18 15:08:09.000000 +00:00",
            )
            + create_test_photos(
                5,
                owner=self.admin,
                geolocation_json={},
                captions_json={"places365": None},
            )
            + create_test_photos_with_faces(
                5,
                owner=self.admin,
                geolocation_json=expectations[0],
                captions_json={"places365": None},
            )
        )
        self._original__random_random = random.random
        self._original__random_choices = random.choices
        self._original__random_choice = random.choice
        self._original__random_shuffle = random.shuffle
        random.choices = lambda x, **kw: x
        random.choice = lambda x: x[0]
        random.shuffle = lambda x: x

    def tearDown(self) -> None:
        random.random = self._original__random_random
        random.choices = self._original__random_choices
        random.choice = self._original__random_choice
        random.shuffle = self._original__random_shuffle

    def test_get_search_term_examples_0(self):
        random.random = lambda: 0
        array = get_search_term_examples(self.admin)
        self.assertEqual(len(array), 3)
        self.assertEqual(set(array), {"phone booth", "2017", "Beach Road"})

    def test_get_search_term_examples_2(self):
        random.random = lambda: 0.5
        array = get_search_term_examples(self.admin)
        self.assertEqual(len(array), 4)
        self.assertEqual(
            set(array),
            {
                "2017",
                "Beach Road 2017",
                "Beach Road",
                "phone booth",
            },
        )

    def test_get_search_term_examples_3(self):
        random.random = lambda: 1
        array = get_search_term_examples(self.admin)
        self.assertEqual(len(array), 7)
        self.assertEqual(
            set(array),
            {
                "2017 phone booth",
                "2017",
                "Beach Road  2017 phone booth",
                "Beach Road 2017",
                "Beach Road phone booth",
                "Beach Road",
                "phone booth",
            },
        )

    def test_get_search_term_examples_without_photos(self):
        Photo.objects.all().delete()
        array = get_search_term_examples(self.admin)
        self.assertEqual(len(array), 5)
        self.assertEqual(
            set(array),
            {
                "for time",
                "for places",
                "for people",
                "for file path or file name",
                "for things",
            },
        )


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
