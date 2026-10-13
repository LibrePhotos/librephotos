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
import re
import shutil
import subprocess
import tempfile
import unittest

import PIL.Image
from django.test import SimpleTestCase, TestCase

from api.metadata.photo_writer import write_photo_metadata
from api.metadata.reader import sidecar_for_write
from api.metadata.tags import Tags
from api.metadata.writer import MetadataWriteError, write_metadata
from api.photos.media_files import get_or_create_file
from api.tests.utils import create_test_photo, create_test_user

EXIFTOOL = shutil.which("exiftool")

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
    """The date tags LibrePhotos reads and writes, against the real binary.

    Whether every tag a write path emits is one ExifTool knows *and* stores in
    the file it is aimed at is checked by ``WriteTargetGuardTest`` in
    ``test_write_back_round_trip``, from the tags the write paths actually emit.
    """

    def setUp(self):
        self.directory = tempfile.mkdtemp(prefix="librephotos-tagnames")
        self.addCleanup(shutil.rmtree, self.directory, True)
        self.image = make_jpeg(self.directory)

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


def _known_names(group):
    """Tag names ExifTool knows in ``group`` (any group when None), lower-cased."""
    # Bytes: the listings hold descriptions in many languages, which the
    # Windows console code page cannot decode.
    args = ["-list"] if group is None else ["-listx", f"-{group}:All"]
    listing = subprocess.run([EXIFTOOL, *args], capture_output=True).stdout
    listing = listing.decode("utf-8", "replace")
    if group is None:
        return {name.lower() for name in listing.split()}
    return {name.lower() for name in re.findall(r"<tag [^>]*name='([^']+)'", listing)}


@unittest.skipUnless(EXIFTOOL, "exiftool binary not available")
class ExifToolReadTagNameTest(SimpleTestCase):
    """Every tag name LibrePhotos reads must be one ExifTool knows.

    Reading an unknown name is not an error: ExifTool just returns nothing.
    ``Tags.ISO`` was ``"EXIF:ISOSpeedRatings"`` and ``Tags.FOCAL_LENGTH_35MM``
    ``"EXIF:FocalLengthIn35mmFilm"`` (the EXIF spec's names for what ExifTool
    calls ``ISO`` and ``FocalLengthIn35mmFormat``), so no photo ever got either.
    """

    def test_every_tag_constant_names_a_known_tag(self):
        known = {}
        for attribute, tag in vars(Tags).items():
            if not attribute.isupper():
                continue
            group, _, name = tag.rpartition(":")
            group = group or None
            # "Name-*" is ExifTool's lang-alt wildcard; the tag itself must exist.
            name = name.removesuffix("-*")
            if group not in known:
                known[group] = _known_names(group)
            with self.subTest(tag=tag):
                self.assertTrue(
                    name.lower() in known[group],
                    f"ExifTool has no tag {name!r} in {group or 'any group'}",
                )


@unittest.skipUnless(EXIFTOOL, "exiftool binary not available")
class TimestampWriteBackRoundTripTest(TestCase):
    """``write_photo_metadata`` timestamp write-back, through real exiftool.

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
        photo.main_file = get_or_create_file(image, self.user)
        photo.timestamp = TIMESTAMP
        return photo, image

    def test_round_trips_into_the_media_file(self):
        photo, image = self._photo_on_disk("media.jpg")

        write_photo_metadata(photo, modified_fields=["timestamp"], use_sidecar=False)

        self.assertEqual(TIMESTAMP_EXIFTOOL, read_tag(image, Tags.DATE_CREATED))

    def test_round_trips_into_the_sidecar(self):
        photo, image = self._photo_on_disk("sidecar.jpg")
        sidecar = sidecar_for_write(image)

        write_photo_metadata(photo, modified_fields=["timestamp"], use_sidecar=True)

        self.assertTrue(os.path.exists(sidecar), "no sidecar was created")
        self.assertEqual(TIMESTAMP_EXIFTOOL, read_tag(sidecar, Tags.DATE_CREATED))

    def test_media_file_write_keeps_the_capture_time(self):
        photo, image = self._photo_on_disk("preserve.jpg")
        run_exiftool(
            "-EXIF:DateTimeOriginal=2005:01:02 03:04:05", "-overwrite_original", image
        )

        write_photo_metadata(photo, modified_fields=["timestamp"], use_sidecar=False)

        self.assertEqual(
            "2005:01:02 03:04:05", read_tag(image, Tags.DATE_TIME_ORIGINAL)
        )

    def test_write_metadata_raises_for_an_unknown_tag(self):
        """The failure mode this module exists to catch; it raises since #2294."""
        image = make_jpeg(self.directory, "bogus.jpg")

        with self.assertRaises(MetadataWriteError) as raised:
            write_metadata(
                image, {"EXIF:DateTime": TIMESTAMP_EXIFTOOL}, use_sidecar=False
            )

        self.assertIn("EXIF:DateTime", str(raised.exception))
        self.assertEqual("", read_tag(image, "EXIF:ModifyDate"))
