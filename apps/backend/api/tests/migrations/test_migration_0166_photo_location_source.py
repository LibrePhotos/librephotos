import importlib
from datetime import timedelta

from django.apps import apps as global_apps
from django.test import TestCase
from django.utils import timezone

from api.geocode.photo_location import needs_geocoding
from api.models import Photo
from api.tests.utils import (
    create_test_metadata_edit,
    create_test_photo,
    create_test_user,
)

# The module name starts with a digit, so a plain import cannot load it.
migration_0166 = importlib.import_module("api.migrations.0166_photo_location_source")

BERLIN = {"_v": "1", "places": ["Berlin", "Germany"]}


class PhotoLocationSourceMigrationTest(TestCase):
    """What an existing library's photos start out as (#2264)."""

    def setUp(self) -> None:
        self.user = create_test_user()

    def photo(self, **fields: object) -> Photo:
        photo = create_test_photo(owner=self.user)
        Photo.objects.filter(pk=photo.pk).update(**fields)
        return photo

    def edit(self, photo: Photo, field_name: str, days_ago: int) -> None:
        create_test_metadata_edit(
            photo, field_name, created_at=timezone.now() - timedelta(days=days_ago)
        )

    def migrate(self) -> None:
        migration_0166.forwards(global_apps, None)

    def test_a_current_place_counts_as_looked_up_for_the_position(self) -> None:
        photo = self.photo(exif_gps_lat=52.5, exif_gps_lon=13.4, geolocation_json=BERLIN)

        self.migrate()

        photo.refresh_from_db()
        self.assertEqual((52.5, 13.4), (photo.geocoded_lat, photo.geocoded_lon))
        self.assertFalse(Photo.objects.filter(pk=photo.pk).filter(needs_geocoding()).exists())

    def test_a_stale_or_missing_place_is_looked_up_again(self) -> None:
        stale = self.photo(
            exif_gps_lat=52.5,
            exif_gps_lon=13.4,
            geolocation_json={**BERLIN, "_v": "0"},
        )
        never = self.photo(exif_gps_lat=48.8, exif_gps_lon=2.3)
        no_position = self.photo(geolocation_json=BERLIN)

        self.migrate()

        self.assertEqual(
            {stale.pk, never.pk},
            set(Photo.objects.filter(needs_geocoding()).values_list("pk", flat=True)),
        )
        no_position.refresh_from_db()
        self.assertIsNone(no_position.geocoded_lat)

    def test_a_location_the_user_edited_is_theirs(self) -> None:
        edited = self.photo(exif_gps_lat=52.5, exif_gps_lon=13.4)
        self.edit(edited, "_all", days_ago=3)
        self.edit(edited, "location", days_ago=2)
        reverted = self.photo(exif_gps_lat=52.5, exif_gps_lon=13.4)
        self.edit(reverted, "location", days_ago=2)
        self.edit(reverted, "_all", days_ago=1)
        other_field = self.photo(exif_gps_lat=52.5, exif_gps_lon=13.4)
        self.edit(other_field, "rating", days_ago=1)
        untouched = self.photo(exif_gps_lat=52.5, exif_gps_lon=13.4)

        self.migrate()

        sources = dict(Photo.objects.values_list("pk", "location_source"))
        self.assertEqual("user", sources[edited.pk])
        self.assertIsNone(sources[reverted.pk])
        self.assertIsNone(sources[other_field.pk])
        self.assertIsNone(sources[untouched.pk])
