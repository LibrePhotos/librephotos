"""The UTC offset of the capture time, read by real ExifTool (#2766-#2768).

Phones and newer cameras write the local capture time in
``EXIF:DateTimeOriginal`` and its offset in ``EXIF:OffsetTimeOriginal``. Some
tools copy that time into ``XMP:DateCreated`` in UTC ("...Z"); the date rules
must still read the local time, and the scan stores the offset next to it.
"""

import datetime
import json

from rest_framework.test import APIClient

from api.metadata.datetime_rules import (
    DEFAULT_RULES_JSON,
    CaptureTime,
    RuleContext,
    as_rules,
    extract_local_date_time,
)
from api.metadata.photo_datetime import extract_date_time
from api.metadata.photo_reader import extract_exif_data, read_file_values
from api.metadata.reader import get_metadata
from api.models import Photo
from api.tests.metadata.exiftool_harness import RealExifToolTestCase
from api.tests.utils import create_test_user

UTC = datetime.UTC
# 2025-06-01 23:30 at UTC-07:00 is 2025-06-02 06:30 UTC.
LOCAL_EVENING = datetime.datetime(2025, 6, 1, 23, 30, tzinfo=UTC)
CAMERA_TAGS = (
    "-EXIF:DateTimeOriginal=2025:06:01 23:30:00",
    "-EXIF:OffsetTimeOriginal=-07:00",
    "-EXIF:OffsetTime=+02:00",
)


class CaptureTimeOffsetRealTest(RealExifToolTestCase):
    def setUp(self) -> None:
        super().setUp()
        self.user = create_test_user()

    def photo(self, *tags: str) -> Photo:
        image = self.make_image()
        self.tag(image, *tags)
        return self.photo_for(image, self.user)

    def test_the_offset_tags_are_read_and_stored_as_written(self) -> None:
        photo = self.photo(*CAMERA_TAGS)

        values = read_file_values(photo)
        extract_exif_data(photo)

        self.assertEqual(
            ("-07:00", "+02:00"),
            (values["offset_time_original"], values["offset_time"]),
        )
        client = APIClient()
        client.force_authenticate(user=self.user)
        response = client.get(f"/api/photos/{photo.id}/metadata")
        self.assertEqual("-07:00", response.json()["timezone_offset"])

    def test_a_date_created_in_utc_is_read_as_the_local_time(self) -> None:
        # #2767: rule 16 ranks above the camera's own date.
        photo = self.photo(*CAMERA_TAGS, "-XMP:DateCreated=2025:06:02 06:30:00Z")
        assert photo.main_file is not None
        path = photo.main_file.path

        found = extract_local_date_time(
            path,
            as_rules(json.loads(DEFAULT_RULES_JSON)),
            lambda tags: get_metadata(path, tags=tags),
            RuleContext(gps_lat=None, gps_lon=None, user_default_tz="UTC"),
        )

        self.assertEqual(CaptureTime(LOCAL_EVENING, -420, 16), found)

    def test_the_scan_stores_the_offset_and_the_rule(self) -> None:
        # #2768: the camera's date (rule 1) with its offset tag.
        photo = self.photo(*CAMERA_TAGS)

        extract_date_time(photo)

        photo = Photo.objects.get(pk=photo.pk)
        self.assertEqual(
            (LOCAL_EVENING, -420, 1),
            (
                photo.exif_timestamp,
                photo.exif_timestamp_offset,
                photo.exif_timestamp_source,
            ),
        )
