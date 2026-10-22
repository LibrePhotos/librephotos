"""The scan reads the date, camera and orientation that videos carry (#2268).

Videos keep these in other tags than photos: an MKV or WebM states its date
only as ``Matroska:DateTimeOriginal`` (UTC), a phone video its local capture
time with offset in the QuickTime ``Keys`` atom (``QuickTime:CreationDate``)
and its make and model there too, and a portrait phone video is stored
landscape with a rotation (``Composite:Rotation``).

These run the scan's metadata step against real ExifTool on videos made with
ffmpeg at test time.
"""

import datetime
import uuid

from api.directory_watcher.file_handlers import _read_metadata
from api.models.photo import Photo
from api.tests.metadata.exiftool_harness import RealExifToolTestCase
from api.tests.utils import create_test_user

SAN_FRANCISCO = (37.7749, -122.4194)


def utc(*parts: int) -> datetime.datetime:
    """A capture time as LibrePhotos stores it: local time, tagged UTC."""
    return datetime.datetime(*parts, tzinfo=datetime.UTC)


class ScanReadsVideoMetadataTest(RealExifToolTestCase):
    def setUp(self) -> None:
        super().setUp()
        self.user = create_test_user()
        self.user.default_timezone = "Europe/Berlin"
        self.user.save(update_fields=["default_timezone"])

    def scan(self, path: str, **fields: object) -> Photo:
        """The scan's metadata step (EXIF, category, date), as ``_process_photo`` runs it."""
        return self.rescan(self.photo_for(path, self.user, video=True, **fields))

    def rescan(self, photo: Photo) -> Photo:
        assert photo.main_file is not None
        _read_metadata(
            photo, photo.main_file.path, str(uuid.uuid4()), datetime.datetime.now()
        )
        return Photo.objects.select_related("main_file", "metadata").get(pk=photo.pk)

    def phone_video(self, name: str, size: str = "64x48") -> str:
        """An MP4 tagged like an iPhone video shot in San Francisco at 03:00."""
        video = self.make_video(name, size=size)
        self.tag(
            video,
            "-Keys:CreationDate=2024:04:03 03:00:00-07:00",
            "-Keys:Make=Apple",
            "-Keys:Model=iPhone 15",
            "-QuickTime:CreateDate=2024:04:03 10:00:00",
        )
        return video

    def test_an_mkv_is_dated_by_its_matroska_date(self) -> None:
        # 17:00 UTC; without a position the default time zone gives the local time.
        video = self.make_video("holiday", ".mkv", creation_time="2025-03-12T17:00:00Z")

        photo = self.scan(video)

        self.assertEqual(utc(2025, 3, 12, 18, 0), photo.exif_timestamp)

    def test_a_webm_is_dated_by_its_matroska_date(self) -> None:
        video = self.make_video("screen", ".webm", creation_time="2023-05-05T12:00:00Z")

        photo = self.scan(video)

        self.assertEqual(utc(2023, 5, 5, 14, 0), photo.exif_timestamp)

    def test_an_mkv_with_a_position_is_dated_in_its_time_zone(self) -> None:
        video = self.make_video("trip", ".mkv", creation_time="2025-03-12T17:00:00Z")

        photo = self.scan(
            video, exif_gps_lat=SAN_FRANCISCO[0], exif_gps_lon=SAN_FRANCISCO[1]
        )

        # San Francisco is on daylight time (UTC-7) since March 9, 2025.
        self.assertEqual(utc(2025, 3, 12, 10, 0), photo.exif_timestamp)

    def test_a_phone_video_keeps_the_local_time_it_states(self) -> None:
        # No position on the row, as on a first scan with location off: the
        # UTC CreateDate alone would be dated in Berlin time (12:00).
        photo = self.scan(self.phone_video("IMG_0001"))

        self.assertEqual(utc(2024, 4, 3, 3, 0), photo.exif_timestamp)

    def test_a_phone_video_shows_its_camera(self) -> None:
        photo = self.scan(self.phone_video("IMG_0002", size="66x48"))

        self.assertEqual("Apple", photo.metadata.camera_make)
        self.assertEqual("iPhone 15", photo.metadata.camera_model)
        self.assertEqual("Apple iPhone 15", photo.metadata.camera_display)

    def test_a_rotated_video_stores_its_shown_size(self) -> None:
        for rotation in (90, 270):
            with self.subTest(rotation=rotation):
                video = self.make_video(f"portrait_{rotation}", size="64x48")
                self.tag(video, f"-Rotation={rotation}")

                photo = self.scan(video)

                self.assertEqual(
                    (48, 64), (photo.metadata.width, photo.metadata.height)
                )

    def test_an_unrotated_or_upside_down_video_keeps_its_size(self) -> None:
        for rotation in (0, 180):
            with self.subTest(rotation=rotation):
                video = self.make_video(f"landscape_{rotation}", size="66x48")
                self.tag(video, f"-Rotation={rotation}")

                photo = self.scan(video)

                self.assertEqual(
                    (66, 48), (photo.metadata.width, photo.metadata.height)
                )

    def test_a_rescan_keeps_the_shown_size(self) -> None:
        video = self.make_video("portrait_again", size="68x48")
        self.tag(video, "-Rotation=90")
        photo = self.scan(video)

        photo = self.rescan(photo)

        self.assertEqual((48, 68), (photo.metadata.width, photo.metadata.height))
