import importlib
from unittest.mock import patch

from django.apps import apps as global_apps
from django.db import connection
from django.test import TestCase

from api.models import PhotoSearch
from api.models.photo_search import fold
from api.tests.utils import create_test_photo, create_test_user

# The module name starts with a digit, so a plain import cannot load it.
migration_0162 = importlib.import_module("api.migrations.0162_photo_search_folded")


class FillSearchFoldedMigrationTest(TestCase):
    """Rows indexed before the column existed get their folded text."""

    def setUp(self):
        self.user = create_test_user()

    def _folded(self, photo):
        return PhotoSearch.objects.get(photo=photo).search_folded

    def _fill(self):
        # The editor is only asked for its connection: no context, no DDL.
        migration_0162.fill_search_folded(global_apps, connection.schema_editor())

    def _forget_folded(self):
        PhotoSearch.objects.update(search_folded="")

    def test_captions_and_location_are_folded(self):
        photo = create_test_photo(
            owner=self.user, search_captions="Café", search_location="Zürich"
        )
        self._forget_folded()

        self._fill()

        self.assertEqual(self._folded(photo), "cafe zurich")

    def test_every_batch_is_filled(self):
        photos = [
            create_test_photo(owner=self.user, search_location=f"Zürich {n}")
            for n in range(5)
        ]
        self._forget_folded()

        with patch.object(migration_0162, "BATCH_SIZE", 2):
            self._fill()

        for n, photo in enumerate(photos):
            self.assertEqual(self._folded(photo), f"zurich {n}")

    def test_an_empty_row_stays_empty(self):
        photo = create_test_photo(owner=self.user, search_captions="")

        self._fill()

        self.assertEqual(self._folded(photo), "")

    def test_the_frozen_fold_matches_the_app(self):
        for text in ("Zürich", "Łódź", "Straße", "ﬁle", "Ærø", "がっこう", "한국"):
            with self.subTest(text=text):
                self.assertEqual(migration_0162.fold(text), fold(text))
