"""The upload's date fallback for files without a date (#2255).

LibrePhotos stores a capture time as the local wall clock labelled UTC. The
mobile app sends ``device_created_at`` as epoch milliseconds, an instant with
no zone, so the upload turns it into the wall clock of ``device_tz_offset``
(minutes east of UTC) or of the owner's default time zone.
"""

from __future__ import annotations

import datetime
import os
import shutil
import tempfile
from unittest.mock import MagicMock, patch

from django.test import RequestFactory, SimpleTestCase, TestCase
from rest_framework_simplejwt.tokens import AccessToken

from api.directory_watcher.file_handlers import apply_device_timestamp_fallback
from api.metadata.datetime_rules import CaptureTime
from api.metadata.photo_datetime import extract_date_time
from api.models import Photo
from api.models.album_date import AlbumDate
from api.models.user import User
from api.tests.utils import create_test_photo, create_test_user
from api.views.upload import (
    UploadPhotosChunkedComplete,
    parse_device_timestamp,
    parse_utc_offset,
)

UTC = datetime.UTC
# A screenshot taken 2025-10-11 21:30 in Los Angeles (UTC-7).
EPOCH_MS = "1760243400000"
LOCAL_WALL_CLOCK = datetime.datetime(2025, 10, 11, 21, 30, tzinfo=UTC)


class _StagedUpload:
    """The staged upload on_completion reads from disk."""

    def __init__(self, path: str) -> None:
        with open(path, "wb") as handle:
            handle.write(os.urandom(32))
        self.file = MagicMock()
        self.file.path = path

    def close(self) -> None:
        pass


def upload_device_time(user: User, **fields: str) -> CaptureTime | None:
    """The fallback date ``/api/upload/complete/`` hands to the import."""
    staged = os.path.join(user.scan_directory, "staged.png")
    request = RequestFactory().post(
        "/api/upload/complete/",
        {"filename": "shot.png", "upload_id": "abc", **fields},
    )
    request.COOKIES["jwt"] = str(AccessToken.for_user(user))
    with (
        patch("api.views.upload.get_object_or_404"),
        patch("api.views.upload.is_valid_media", return_value=True),
        patch.object(UploadPhotosChunkedComplete, "import_photo") as import_photo,
    ):
        UploadPhotosChunkedComplete().on_completion(_StagedUpload(staged), request)
    return import_photo.call_args.kwargs["device_time"]


def upload_fallback(user: User, **fields: str) -> datetime.datetime | None:
    """The wall clock of ``upload_device_time``."""
    device_time = upload_device_time(user, **fields)
    return device_time.local_time if device_time else None


def uploader(**fields: object) -> User:
    scan_dir = tempfile.mkdtemp(prefix="upload-scan-")
    user = create_test_user(scan_directory=scan_dir, **fields)
    return user


class UploadDateFallbackTest(TestCase):
    """What the upload hands to the import as the fallback date."""

    def setUp(self) -> None:
        self.user = uploader()
        self.addCleanup(shutil.rmtree, self.user.scan_directory, True)

    def test_epoch_ms_with_the_device_offset(self) -> None:
        fallback = upload_fallback(
            self.user, device_created_at=EPOCH_MS, device_tz_offset="-420"
        )
        self.assertEqual(LOCAL_WALL_CLOCK, fallback)

    def test_epoch_ms_in_the_owners_time_zone(self) -> None:
        self.user.default_timezone = "America/Los_Angeles"
        self.user.save()

        fallback = upload_fallback(self.user, device_created_at=EPOCH_MS)

        self.assertEqual(LOCAL_WALL_CLOCK, fallback)

    def test_iso_with_an_offset_keeps_its_wall_clock(self) -> None:
        fallback = upload_fallback(
            self.user, device_created_at="2025-10-11T21:30:00-07:00"
        )
        assert isinstance(fallback, datetime.datetime)
        # Equal as instants is not enough: the stored value is the wall clock.
        self.assertEqual(
            (2025, 10, 11, 21, 30, UTC),
            (
                fallback.year,
                fallback.month,
                fallback.day,
                fallback.hour,
                fallback.minute,
                fallback.tzinfo,
            ),
        )

    def test_a_compact_date_is_not_epoch_milliseconds(self) -> None:
        self.assertIsNone(upload_fallback(self.user, device_created_at="20251011"))

    def test_the_modification_time_stands_in_for_a_missing_creation_time(
        self,
    ) -> None:
        fallback = upload_fallback(
            self.user, device_modified_at=EPOCH_MS, device_tz_offset="-420"
        )
        self.assertEqual(LOCAL_WALL_CLOCK, fallback)

    def test_creation_time_wins_over_modification_time(self) -> None:
        fallback = upload_fallback(
            self.user,
            device_created_at="2025-10-11T21:30:00",
            device_modified_at="2025-12-24T10:00:00",
        )
        self.assertEqual(LOCAL_WALL_CLOCK, fallback)

    def test_the_utc_offset_of_the_wall_clock_goes_with_it(self) -> None:
        # (#2768) The offset an ISO 8601 value states wins over device_tz_offset.
        iso = "2025-10-11T21:30:00"
        cases = [
            ({"device_created_at": EPOCH_MS, "device_tz_offset": "-420"}, -420),
            ({"device_created_at": EPOCH_MS}, None),
            ({"device_created_at": iso + "-07:00", "device_tz_offset": "120"}, -420),
            ({"device_created_at": iso + "Z"}, 0),
            ({"device_created_at": iso, "device_tz_offset": "330"}, 330),
            ({"device_created_at": iso}, None),
            (
                {
                    "device_created_at": "20251011",
                    "device_modified_at": EPOCH_MS,
                    "device_tz_offset": "-420",
                },
                -420,
            ),
        ]
        for fields, offset in cases:
            with self.subTest(fields=fields):
                device_time = upload_device_time(self.user, **fields)
                assert device_time is not None
                self.assertEqual(offset, device_time.utc_offset)

    def test_no_device_time_no_fallback(self) -> None:
        self.assertIsNone(upload_device_time(self.user, device_tz_offset="-420"))


class ParseDeviceTimestampTest(SimpleTestCase):
    def test_iso_forms(self) -> None:
        for raw in (
            "2025-10-11T21:30:00",
            "2025-10-11T21:30:00Z",
            "2025-10-11T21:30:00+00:00",
            "2025-10-11T21:30:00-07:00",
            " 2025-10-11T21:30:00+05:30 ",
        ):
            with self.subTest(raw=raw):
                self.assertEqual(LOCAL_WALL_CLOCK, parse_device_timestamp(raw))

    def test_epoch_ms_as_a_number_in_utc(self) -> None:
        self.assertEqual(
            datetime.datetime(2025, 10, 12, 4, 30, tzinfo=UTC),
            parse_device_timestamp(int(EPOCH_MS)),
        )

    def test_an_offset_wins_over_the_owners_time_zone(self) -> None:
        self.assertEqual(
            LOCAL_WALL_CLOCK,
            parse_device_timestamp(
                EPOCH_MS, datetime.timedelta(minutes=-420), "Europe/Berlin"
            ),
        )

    def test_an_unknown_time_zone_name_falls_back_to_utc(self) -> None:
        self.assertEqual(
            datetime.datetime(2025, 10, 12, 4, 30, tzinfo=UTC),
            parse_device_timestamp(EPOCH_MS, None, "Not/AZone"),
        )

    def test_unusable_values(self) -> None:
        for raw in (None, "", "20251011", "1760243400", "yesterday", "9" * 30):
            with self.subTest(raw=raw):
                self.assertIsNone(parse_device_timestamp(raw))

    def test_utc_offsets(self) -> None:
        for raw, minutes in [("-420", -420), ("+330", 330), ("0", 0)]:
            with self.subTest(raw=raw):
                self.assertEqual(
                    datetime.timedelta(minutes=minutes), parse_utc_offset(raw)
                )
        for raw in (None, "", "UTC-7", "-7.5", "900", "-10000"):
            with self.subTest(raw=raw):
                self.assertIsNone(parse_utc_offset(raw))


class UndatedUploadDayAlbumTest(TestCase):
    def test_undated_upload_lands_on_the_local_day(self) -> None:
        user = uploader(default_timezone="America/Los_Angeles")
        self.addCleanup(shutil.rmtree, user.scan_directory, True)
        photo = create_test_photo(owner=user)
        self.assertIsNone(photo.exif_timestamp)
        fallback = upload_device_time(user, device_created_at=EPOCH_MS)
        assert fallback is not None

        # The file carries no date; the exif service is not running here.
        with patch(
            "api.metadata.photo_datetime.get_metadata",
            side_effect=lambda path, tags, **kwargs: [None] * len(tags),
        ):
            apply_device_timestamp_fallback(photo, fallback)

        photo.refresh_from_db()
        self.assertEqual(LOCAL_WALL_CLOCK, photo.exif_timestamp)
        # The owner's zone is a guess, not an offset the device stated (#2768).
        self.assertEqual(
            (None, None), (photo.exif_timestamp_offset, photo.exif_timestamp_source)
        )

    def test_the_device_offset_stays_with_the_date(self) -> None:
        user = uploader()
        self.addCleanup(shutil.rmtree, user.scan_directory, True)
        photo = create_test_photo(owner=user)
        fallback = upload_device_time(
            user, device_created_at=EPOCH_MS, device_tz_offset="-420"
        )
        assert fallback is not None

        with patch(
            "api.metadata.photo_datetime.get_metadata",
            side_effect=lambda path, tags, **kwargs: [None] * len(tags),
        ):
            apply_device_timestamp_fallback(photo, fallback)
            # A rescan keeps it: the device time is the photo's date now.
            extract_date_time(Photo.objects.get(pk=photo.pk))

        photo.refresh_from_db()
        self.assertEqual(
            (LOCAL_WALL_CLOCK, -420, None),
            (
                photo.exif_timestamp,
                photo.exif_timestamp_offset,
                photo.exif_timestamp_source,
            ),
        )
        self.assertEqual(
            [datetime.date(2025, 10, 11)],
            list(AlbumDate.objects.filter(photos=photo).values_list("date", flat=True)),
        )
