import random

from django.test import TestCase

from api.api_util import get_search_term_examples
from api.models import Photo
from api.tests.fixtures.api_util.captions_json import captions_json
from api.tests.fixtures.geocode.expectations.mapbox import expectations
from api.tests.utils import (
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
