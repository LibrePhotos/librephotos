"""Line breaks in written values must not reach ExifTool as new arguments.

PyExifTool feeds ``exiftool -stay_open True -@ -`` one argument per line, so
a person name like ``"Joe\\n-if\\n<perl>"`` used to become an ``-if`` option
whose Perl expression ExifTool evaluated.
"""

import os
import shutil
import subprocess
import tempfile
import unittest

import PIL.Image
from django.test import SimpleTestCase

from api.metadata.face_regions import build_face_region_exiftool_args
from api.metadata.writer import write_metadata
from api.runtime import binaries

INJECTED = "Joe\n-IFD0:Copyright=INJECTED"


def _exiftool():
    try:
        return binaries.exiftool()
    except Exception:
        return shutil.which("exiftool")


EXIFTOOL = _exiftool()


class FaceRegionNamesAreSingleLineTest(SimpleTestCase):
    def test_line_breaks_in_a_name_become_spaces(self):
        tags = build_face_region_exiftool_args(
            [
                {
                    "name": "Joe\r\n-if\nsystem('id')#",
                    "x": 0.5,
                    "y": 0.5,
                    "w": 0.1,
                    "h": 0.1,
                }
            ]
        )

        for value in [tags["XMP-mwg-rs:RegionInfo"], *tags["XMP:Subject"]]:
            self.assertNotIn("\n", value)
            self.assertNotIn("\r", value)
        self.assertEqual(tags["XMP:Subject"], ["Joe  -if system('id')#"])


@unittest.skipUnless(EXIFTOOL, "exiftool binary not available")
class WriteMetadataRefusesLineBreaksTest(SimpleTestCase):
    def setUp(self):
        self.directory = tempfile.mkdtemp(prefix="librephotos-exif-write")
        self.addCleanup(shutil.rmtree, self.directory, ignore_errors=True)
        self.photo = os.path.join(self.directory, "photo.jpg")
        PIL.Image.new("RGB", (16, 16), (90, 60, 30)).save(self.photo)

    def _copyright(self):
        result = subprocess.run(
            [EXIFTOOL, "-s3", "-IFD0:Copyright", self.photo],
            capture_output=True,
            text=True,
            check=True,
        )
        return result.stdout.strip()

    def test_a_line_break_in_a_value_is_refused(self):
        with self.assertRaises(ValueError):
            write_metadata(self.photo, {"XMP:Subject": [INJECTED]}, use_sidecar=False)

        self.assertEqual(self._copyright(), "")

    def test_a_carriage_return_is_refused(self):
        with self.assertRaises(ValueError):
            write_metadata(
                self.photo,
                {"XMP:Subject": INJECTED.replace("\n", "\r")},
                use_sidecar=False,
            )

        self.assertEqual(self._copyright(), "")

    def test_face_tags_with_an_injected_name_write_only_the_name(self):
        tags = build_face_region_exiftool_args(
            [{"name": INJECTED, "x": 0.5, "y": 0.5, "w": 0.1, "h": 0.1}]
        )

        write_metadata(self.photo, tags, use_sidecar=False)

        self.assertEqual(self._copyright(), "")
        subject = subprocess.run(
            [EXIFTOOL, "-s3", "-XMP:Subject", self.photo],
            capture_output=True,
            text=True,
            check=True,
        ).stdout.strip()
        self.assertEqual(subject, "Joe -IFD0:Copyright=INJECTED")
