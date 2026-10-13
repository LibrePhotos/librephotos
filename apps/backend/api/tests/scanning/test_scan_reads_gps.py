"""The scan reads a photo's GPS position itself (#2263).

The date rules that convert a UTC date to the local time at the photo's
position (rule 2 for video creation dates, rule 11 for ``GPSDateTime``) read
``Photo.exif_gps_lat/lon``. Those used to be filled only by the geolocation
job, which runs after the scan (and not at all with reverse geocoding off),
so on the first scan of a file the rules never applied and a later "Rescan
all photos" gave a different date.

These run the scan's metadata step against real ExifTool.
"""

import datetime
import uuid

from django.test import override_settings

from api.classification.screenshots import classify
from api.directory_watcher.file_handlers import _read_metadata
from api.models.photo import Photo
from api.tests.metadata.exiftool_harness import RealExifToolTestCase
from api.tests.utils import create_test_user

SAN_FRANCISCO = (37.7749, -122.4194)
BERLIN = (52.52, 13.405)


class ScanReadsGpsTest(RealExifToolTestCase):
    def setUp(self) -> None:
        super().setUp()
        self.user = create_test_user()
        self.user.default_timezone = "Europe/Berlin"
        self.user.save(update_fields=["default_timezone"])

    def tag_position(self, path: str, lat: float, lon: float) -> None:
        self.tag(
            path,
            f"-GPSLatitude={abs(lat)}",
            f"-GPSLatitudeRef={'S' if lat < 0 else 'N'}",
            f"-GPSLongitude={abs(lon)}",
            f"-GPSLongitudeRef={'W' if lon < 0 else 'E'}",
        )

    def scan(self, photo: Photo) -> Photo:
        """The scan's metadata step (EXIF, category, date), as ``_process_photo`` runs it."""
        assert photo.main_file is not None
        _read_metadata(
            photo, photo.main_file.path, str(uuid.uuid4()), datetime.datetime.now()
        )
        return Photo.objects.get(pk=photo.pk)

    @override_settings(FEATURE_REVERSE_GEOCODING=False)
    def test_the_first_scan_dates_by_the_time_zone_of_the_position(self) -> None:
        # A JPEG with a GPS fix and GPS time (10:00 UTC), but no
        # DateTimeOriginal: rule 11 must turn it into San Francisco time.
        image = self.make_image(name="trip")
        self.tag_position(image, *SAN_FRANCISCO)
        self.tag(image, "-GPSDateStamp=2024:04:03", "-GPSTimeStamp=10:00:00")
        photo = self.photo_for(image, self.user)

        photo = self.scan(photo)

        self.assertEqual(
            datetime.datetime(2024, 4, 3, 3, 0, tzinfo=datetime.timezone.utc),
            photo.exif_timestamp,
        )
        self.assertEqual(SAN_FRANCISCO, (photo.exif_gps_lat, photo.exif_gps_lon))
        # The scan stores the position, it does not look up the place.
        self.assertIsNone(photo.geolocation_json)

    def test_null_island_is_no_position(self) -> None:
        image = self.make_image(name="no_fix")
        self.tag_position(image, 0, 0)
        photo = self.photo_for(image, self.user)

        photo = self.scan(photo)

        self.assertEqual((None, None), (photo.exif_gps_lat, photo.exif_gps_lon))

    def test_a_file_without_gps_keeps_a_stored_position(self) -> None:
        image = self.make_image(name="manual")
        photo = self.photo_for(
            image, self.user, exif_gps_lat=BERLIN[0], exif_gps_lon=BERLIN[1]
        )

        photo = self.scan(photo)

        self.assertEqual(BERLIN, (photo.exif_gps_lat, photo.exif_gps_lon))

    def test_a_file_with_other_gps_keeps_the_stored_position(self) -> None:
        # Replacing a position the row already has needs to know whether the
        # file or the user set it, and what was geocoded (#2264).
        image = self.make_image(name="moved")
        self.tag_position(image, *SAN_FRANCISCO)
        photo = self.photo_for(
            image, self.user, exif_gps_lat=BERLIN[0], exif_gps_lon=BERLIN[1]
        )

        photo = self.scan(photo)

        self.assertEqual(BERLIN, (photo.exif_gps_lat, photo.exif_gps_lon))

    def test_a_png_with_gps_is_no_screenshot_on_its_first_scan(self) -> None:
        image = self.make_image(".png", name="map_pin")
        self.tag_position(image, *SAN_FRANCISCO)
        photo = self.photo_for(image, self.user)

        photo = self.scan(photo)

        self.assertFalse(classify(photo))
        self.assertFalse(photo.is_screenshot)
