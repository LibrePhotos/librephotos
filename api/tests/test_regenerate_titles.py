from datetime import datetime

import pytz
from django.test import TestCase

from api.models import AlbumAuto, User


class RegenerateTitlesTestCase(TestCase):
    def test_regenerate_titles(self):
        admin = User.objects.create_superuser(
            "test_admin", "test_admin@test.com", "test_password"
        )
        album_auto = AlbumAuto.objects.create(
            timestamp=datetime.strptime("2022-01-02", "%Y-%m-%d").replace(
                tzinfo=pytz.utc
            ),
            created_on=datetime.strptime("2022-01-02", "%Y-%m-%d").replace(
                tzinfo=pytz.utc
            ),
            owner=admin,
        )
        album_auto._generate_title()
        self.assertEqual(album_auto.title, "Sunday")
