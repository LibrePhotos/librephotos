"""Non-mocked exiftool tests.

The rest of the suite patches :func:`api.metadata.writer.write_metadata` away, so
a tag name ExifTool does not recognise ships green. ``Tags.DATE_TIME`` was
``"EXIF:DateTime"`` for years - a name ExifTool has never accepted, since it
calls EXIF tag 0x0132 ``ModifyDate`` - which meant both the datetime rule using
it and the timestamp write-back silently did nothing. These tests run the real
binary so that class of bug fails loudly.
"""

import datetime
import os
import shutil
import subprocess
import tempfile
import unittest

import PIL.Image
from django.test import SimpleTestCase, TestCase

from api.metadata.reader import get_sidecar_files_in_priority_order
from api.metadata.tags import Tags
from api.metadata.writer import write_metadata
from api.models.file import File
from api.tests.utils import create_test_photo, create_test_user

EXIFTOOL = shutil.which("exiftool")

# Only the tags LibrePhotos actually writes. Plenty of entries in ``Tags`` are
# legitimately read-only (Composite:GPSLatitude, File:FileSize, ImageHeight,
# ...), so this is deliberately not a blanket sweep over the class.
WRITTEN_TAGS = [
    Tags.RATING,
    Tags.DATE_CREATED,
    Tags.REGION_INFO_WRITE,
    Tags.SUBJECT,
]

# What ExifTool says when it does not know a tag name.
UNKNOWN_TAG_MARKERS = (
    "doesn't exist or isn't writable",
    "is not defined",
)

TIMESTAMP = datetime.datetime(2019, 8, 15, 7, 45, 0, tzinfo=datetime.timezone.utc)
TIMESTAMP_EXIFTOOL = "2019:08:15 07:45:00"


def run_exiftool(*args):
    return subprocess.run([EXIFTOOL, *args], capture_output=True, text=True)


def read_tag(path, tag):
    """Read a single tag value with a bare exiftool call (-s3 = value only)."""
    return run_exiftool(f"-{tag}", "-s3", path).stdout.strip()


def make_jpeg(directory, name="test.jpg"):
    path = os.path.join(directory, name)
    PIL.Image.new("RGB", (16, 12), (10, 20, 30)).save(path)
    return path


@unittest.skipUnless(EXIFTOOL, "exiftool binary not available")
class ExifToolTagNameTest(SimpleTestCase):
    """Every tag name LibrePhotos writes must be one ExifTool knows."""

    def setUp(self):
        self.directory = tempfile.mkdtemp(prefix="librephotos-tagnames")
        self.addCleanup(shutil.rmtree, self.directory, True)
        self.image = make_jpeg(self.directory)

    def test_written_tags_are_writable(self):
        for tag in WRITTEN_TAGS:
            with self.subTest(tag=tag):
                # An empty value is a delete, which is enough to make ExifTool
                # resolve the name without caring about value formatting.
                result = run_exiftool(f"-{tag}=", "-overwrite_original", self.image)
                for marker in UNKNOWN_TAG_MARKERS:
                    self.assertNotIn(
                        marker,
                        result.stderr,
                        f"exiftool does not know the tag {tag!r}: {result.stderr}",
                    )

    def test_date_time_tag_reads_back_modify_date(self):
        """``Tags.DATE_TIME`` must name the EXIF tag exiftool calls ModifyDate.

        Regression guard for ``DATE_TIME = "EXIF:DateTime"``: written with the
        literal ExifTool name and read back through the constant, so a wrong
        constant fails here.
        """
        written = run_exiftool(
            f"-EXIF:ModifyDate={TIMESTAMP_EXIFTOOL}",
            "-overwrite_original",
            self.image,
        )
        self.assertEqual(0, written.returncode, written.stderr)

        self.assertEqual(TIMESTAMP_EXIFTOOL, read_tag(self.image, Tags.DATE_TIME))

    def test_date_time_tag_is_writable(self):
        result = run_exiftool(
            f"-{Tags.DATE_TIME}={TIMESTAMP_EXIFTOOL}",
            "-overwrite_original",
            self.image,
        )
        self.assertEqual(0, result.returncode, result.stderr)
        self.assertEqual(TIMESTAMP_EXIFTOOL, read_tag(self.image, Tags.DATE_TIME))

    def test_date_created_write_preserves_original_capture_time(self):
        """Writing our date must not clobber the camera's DateTimeOriginal."""
        run_exiftool(
            "-EXIF:DateTimeOriginal=2005:01:02 03:04:05",
            "-overwrite_original",
            self.image,
        )

        result = run_exiftool(
            f"-{Tags.DATE_CREATED}={TIMESTAMP_EXIFTOOL}",
            "-overwrite_original",
            self.image,
        )
        self.assertEqual(0, result.returncode, result.stderr)

        self.assertEqual(TIMESTAMP_EXIFTOOL, read_tag(self.image, Tags.DATE_CREATED))
        self.assertEqual(
            "2005:01:02 03:04:05", read_tag(self.image, Tags.DATE_TIME_ORIGINAL)
        )

    def test_exif_date_tags_do_not_round_trip_through_a_sidecar(self):
        """Why the write-back uses XMP:DateCreated instead of an EXIF date tag.

        ExifTool accepts ``-EXIF:DateTimeOriginal=`` against an ``.xmp`` and then
        writes nothing at all, exit code 0 - a silent no-op.
        """
        sidecar = os.path.join(self.directory, "sidecar.xmp")
        run_exiftool(f"-{Tags.DATE_CREATED}={TIMESTAMP_EXIFTOOL}", sidecar)
        self.assertTrue(os.path.exists(sidecar))

        result = run_exiftool(
            f"-{Tags.DATE_TIME_ORIGINAL}={TIMESTAMP_EXIFTOOL}",
            "-overwrite_original",
            sidecar,
        )
        self.assertEqual(0, result.returncode, result.stderr)
        self.assertEqual("", read_tag(sidecar, Tags.DATE_TIME_ORIGINAL))
        # ... while the XMP tag we do use is readable from the same sidecar.
        self.assertEqual(TIMESTAMP_EXIFTOOL, read_tag(sidecar, Tags.DATE_CREATED))


@unittest.skipUnless(EXIFTOOL, "exiftool binary not available")
class TimestampWriteBackRoundTripTest(TestCase):
    """``Photo._save_metadata`` timestamp write-back, through real exiftool.

    This path had never actually executed: ``Tags.DATE_TIME`` was not a real tag,
    so nothing was ever written and the serialized value was never validated.
    """

    def setUp(self):
        self.user = create_test_user()
        self.directory = tempfile.mkdtemp(prefix="librephotos-writeback")
        self.addCleanup(shutil.rmtree, self.directory, True)

    def _photo_on_disk(self, name):
        image = make_jpeg(self.directory, name)
        photo = create_test_photo(owner=self.user)
        photo.main_file = File.create(image, self.user)
        photo.timestamp = TIMESTAMP
        return photo, image

    def test_round_trips_into_the_media_file(self):
        photo, image = self._photo_on_disk("media.jpg")

        photo._save_metadata(modified_fields=["timestamp"], use_sidecar=False)

        self.assertEqual(TIMESTAMP_EXIFTOOL, read_tag(image, Tags.DATE_CREATED))

    def test_round_trips_into_the_sidecar(self):
        photo, image = self._photo_on_disk("sidecar.jpg")
        sidecar = get_sidecar_files_in_priority_order(image)[0]

        photo._save_metadata(modified_fields=["timestamp"], use_sidecar=True)

        self.assertTrue(os.path.exists(sidecar), "no sidecar was created")
        self.assertEqual(TIMESTAMP_EXIFTOOL, read_tag(sidecar, Tags.DATE_CREATED))

    def test_media_file_write_keeps_the_capture_time(self):
        photo, image = self._photo_on_disk("preserve.jpg")
        run_exiftool(
            "-EXIF:DateTimeOriginal=2005:01:02 03:04:05", "-overwrite_original", image
        )

        photo._save_metadata(modified_fields=["timestamp"], use_sidecar=False)

        self.assertEqual(
            "2005:01:02 03:04:05", read_tag(image, Tags.DATE_TIME_ORIGINAL)
        )

    def test_write_metadata_writes_nothing_for_an_unknown_tag(self):
        """Documents the failure mode this module exists to catch."""
        image = make_jpeg(self.directory, "bogus.jpg")

        write_metadata(image, {"EXIF:DateTime": TIMESTAMP_EXIFTOOL}, use_sidecar=False)

        self.assertEqual("", read_tag(image, "EXIF:ModifyDate"))
