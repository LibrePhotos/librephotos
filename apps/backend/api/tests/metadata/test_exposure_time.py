"""Shutter speeds are stored as ExifTool prints them (#2275).

The exif service reads ``EXIF:ExposureTime`` with ``-n``, as seconds. The scan
used to turn that into ``Fraction(...).limit_denominator(1000)``: anything
faster than about 1/2000 s became "0", 1/1250 to 1/2000 s all became
"1/1000", and long exposures became improper fractions ("5/2" for 2.5 s).
"""

from io import StringIO
from unittest.mock import patch

from django.core.management import call_command
from django.test import SimpleTestCase, TestCase

from api.metadata.photo_reader import extract_exif_data
from api.metadata.reader import MetadataReadError
from api.metadata.tags import Tags
from api.models.photo_metadata import PhotoMetadata, format_exposure_time
from api.tests.metadata.exiftool_harness import RealExifToolTestCase
from api.tests.utils import create_test_photo, create_test_user


class FormatExposureTimeTest(SimpleTestCase):
    def test_exposure_times_read_as_exiftool_prints_them(self) -> None:
        for seconds, expected in (
            (1 / 250, "1/250"),
            (0.004, "1/250"),
            (1 / 1600, "1/1600"),
            (1 / 2000, "1/2000"),
            (1 / 8000, "1/8000"),
            (0.25, "1/4"),
            (0.3, "0.3"),
            (1, "1"),
            (2.5, "2.5"),
            (30, "30"),
            (0, None),
            (-1, None),
            (None, None),
            ("1/250", None),
            (True, None),
        ):
            with self.subTest(seconds=seconds):
                self.assertEqual(expected, format_exposure_time(seconds))


class ExposureTimeFromTheFileTest(RealExifToolTestCase):
    """Written to a JPEG and read through the exif service (``-G -n``)."""

    def setUp(self) -> None:
        super().setUp()
        self.user = create_test_user()

    def shutter_speed_of(self, exposure_time: str) -> str | None:
        image = self.make_image(name=exposure_time.replace("/", "_"))
        self.tag(image, f"-EXIF:ExposureTime={exposure_time}")
        metadata = extract_exif_data(self.photo_for(image, self.user))
        assert metadata is not None
        return metadata.shutter_speed

    def test_a_fast_shutter_speed(self) -> None:
        self.assertEqual("1/4000", self.shutter_speed_of("1/4000"))

    def test_a_long_exposure(self) -> None:
        self.assertEqual("2.5", self.shutter_speed_of("2.5"))

    def test_the_command_repairs_a_stored_zero(self) -> None:
        image = self.make_image(name="repair")
        self.tag(image, "-EXIF:ExposureTime=1/4000")
        # The row as an older version stored it.
        photo = self.photo_for(image, self.user, shutter_speed="0")
        metadata = PhotoMetadata.objects.get(photo=photo)

        call_command("refresh_exposure_time", stdout=StringIO())

        metadata.refresh_from_db()
        self.assertEqual(
            ("1/4000", 0.00025),
            (metadata.shutter_speed, metadata.shutter_speed_seconds),
        )


class RefreshExposureTimeCommandTest(TestCase):
    def setUp(self) -> None:
        self.user = create_test_user()

    def metadata(self, shutter_speed: str | None) -> PhotoMetadata:
        """A row as an older version stored it."""
        photo = create_test_photo(owner=self.user, iso=100, shutter_speed=shutter_speed)
        return PhotoMetadata.objects.get(photo=photo)

    def run_command(
        self, values: dict[str, object], *arguments: str
    ) -> tuple[list[str], str]:
        """Run the command, the file of each photo holding ``values[path]``."""
        read: list[str] = []

        def get_metadata(path: str, tags: list[str], **_: object) -> list[object]:
            self.assertEqual([Tags.EXPOSURE_TIME], tags)
            read.append(path)
            value = values[path]
            if isinstance(value, Exception):
                raise value
            return [value]

        out = StringIO()
        with patch("api.metadata.photo_reader.get_metadata", side_effect=get_metadata):
            call_command("refresh_exposure_time", *arguments, stdout=out)
        return read, out.getvalue()

    def path_of(self, metadata: PhotoMetadata) -> str:
        assert metadata.photo.main_file is not None
        return metadata.photo.main_file.path

    def test_only_the_rows_the_old_conversion_got_wrong_are_read(self) -> None:
        zero = self.metadata("0")
        capped = self.metadata("1/1000")
        long_exposure = self.metadata("5/2")
        tenths = self.metadata("3/10")
        fine = [self.metadata(value) for value in ("1/250", "30", "1", None)]

        read, out = self.run_command(
            {
                self.path_of(zero): 1 / 4000,
                self.path_of(capped): 1 / 1600,
                self.path_of(long_exposure): 2.5,
                self.path_of(tenths): 0.3,
            }
        )

        self.assertCountEqual(
            [self.path_of(m) for m in (zero, capped, long_exposure, tenths)], read
        )
        self.assertEqual(
            ["1/4000", "1/1600", "2.5", "0.3"],
            [
                PhotoMetadata.objects.get(pk=m.pk).shutter_speed
                for m in (zero, capped, long_exposure, tenths)
            ],
        )
        self.assertEqual(
            ["1/250", "30", "1", None],
            [PhotoMetadata.objects.get(pk=m.pk).shutter_speed for m in fine],
        )
        self.assertIn("Updated 4 of 4", out)

    def test_dry_run_reads_nothing_and_changes_nothing(self) -> None:
        zero = self.metadata("0")

        read, out = self.run_command({}, "--dry-run")

        self.assertEqual([], read)
        self.assertEqual("0", PhotoMetadata.objects.get(pk=zero.pk).shutter_speed)
        self.assertIn("1 photo", out)

    def test_a_file_that_cannot_be_read_is_skipped(self) -> None:
        broken = self.metadata("0")
        zero = self.metadata("0")

        _, out = self.run_command(
            {
                self.path_of(broken): MetadataReadError("gone"),
                self.path_of(zero): 1 / 8000,
            }
        )

        self.assertEqual("0", PhotoMetadata.objects.get(pk=broken.pk).shutter_speed)
        self.assertEqual("1/8000", PhotoMetadata.objects.get(pk=zero.pk).shutter_speed)
        self.assertIn("Updated 1 of 2", out)
        self.assertIn("1 could not be read", out)
