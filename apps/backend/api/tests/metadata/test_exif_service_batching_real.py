"""The exif sidecar's batched read against the real ExifTool.

``highest_priority_values`` asks for every tag of every file in one command;
it must give exactly what asking per tag and per file gave, including where
ExifTool files a tag under another group or several groups.
"""

import os
import shutil
import subprocess
import tempfile
import unittest

import exiftool
import PIL.Image
from django.test import SimpleTestCase

from api.metadata.tags import Tags
from api.models.photo_metadata import EXIF_TAGS
from service.exif.main import (
    _attribute,
    highest_priority_value,
    highest_priority_values,
)

EXIFTOOL = shutil.which("exiftool")
FIXTURES = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "fixtures"
)
ALL_TAGS = sorted(
    {value for name, value in vars(Tags).items() if name.isupper()} | set(EXIF_TAGS)
)


@unittest.skipUnless(EXIFTOOL, "exiftool binary not available")
class BatchedReadMatchesPerTagReadTest(SimpleTestCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.plain = exiftool.ExifTool(EXIFTOOL)
        cls.struct = exiftool.ExifTool(EXIFTOOL, common_args=["-struct"])
        cls.plain.start()
        cls.struct.start()
        cls.directory = tempfile.mkdtemp(prefix="librephotos-exif-batch")

        # A camera-like JPEG: EXIF, GPS, XMP rating and keywords, IPTC, and a
        # sidecar that overrides the rating.
        cls.camera = os.path.join(cls.directory, "camera.jpg")
        PIL.Image.new("RGB", (64, 48), (90, 60, 30)).save(cls.camera)
        subprocess.run(
            [
                EXIFTOOL,
                "-overwrite_original",
                "-EXIF:Model=Test Cam",
                "-EXIF:ISO=800",
                "-EXIF:FNumber=2.8",
                "-EXIF:ExposureTime=0.004",
                "-EXIF:DateTimeOriginal=2021:07:04 12:30:00",
                "-EXIF:SubSecTimeOriginal=123",
                "-EXIF:Orientation#=6",
                "-GPSLatitude=48.137",
                "-GPSLatitudeRef=N",
                "-GPSLongitude=11.575",
                "-GPSLongitudeRef=E",
                "-XMP:Rating=3",
                "-XMP:Subject=alps",
                "-IPTC:Keywords=hike",
                cls.camera,
            ],
            check=True,
            capture_output=True,
        )
        cls.sidecar = os.path.join(cls.directory, "camera.xmp")
        # Writing to a file that does not exist yet creates an XMP sidecar.
        subprocess.run(
            [EXIFTOOL, "-XMP:Rating=5", cls.sidecar], check=True, capture_output=True
        )

        # A description with language entries only, no x-default one.
        cls.languages = os.path.join(cls.directory, "languages.jpg")
        PIL.Image.new("RGB", (16, 12), (10, 20, 30)).save(cls.languages)
        subprocess.run(
            [
                EXIFTOOL,
                "-overwrite_original",
                "-XMP-dc:Description-de=Hallo",
                "-XMP-dc:Description-fr=Bonjour",
                cls.languages,
            ],
            check=True,
            capture_output=True,
        )

    @classmethod
    def tearDownClass(cls):
        cls.plain.terminate()
        cls.struct.terminate()
        shutil.rmtree(cls.directory, ignore_errors=True)
        super().tearDownClass()

    def cases(self):
        return [
            [self.camera],
            [self.camera, self.sidecar],
            [os.path.join(FIXTURES, "niaz.jpg"), os.path.join(FIXTURES, "niaz.xmp")],
            [os.path.join(FIXTURES, "iptc_test.jpg")],
            [self.languages],
        ]

    def test_batched_equals_per_tag_for_every_tag_we_read(self):
        for et in (self.plain, self.struct):
            for files in self.cases():
                with self.subTest(files=files, struct=et is self.struct):
                    expected = [highest_priority_value(et, t, files) for t in ALL_TAGS]
                    self.assertEqual(
                        highest_priority_values(et, ALL_TAGS, files), expected
                    )

    def test_the_fixture_is_not_trivially_empty(self):
        values = dict(
            zip(
                ALL_TAGS,
                highest_priority_values(
                    self.plain, ALL_TAGS, [self.camera, self.sidecar]
                ),
            )
        )
        self.assertEqual(values[Tags.CAMERA], "Test Cam")
        self.assertEqual(values[Tags.ISO], 800)
        self.assertEqual(values[Tags.RATING], 5)  # the sidecar wins
        self.assertIsNotNone(values[Tags.IMAGE_WIDTH])
        self.assertIsNotNone(values[Tags.LATITUDE])

    def test_language_wildcard_is_answered_by_the_batch(self):
        # Every Description-<lang> key must be claimed by the wildcard request,
        # or each such file would fall back to one command per tag.
        data = self.plain.get_tags_batch(ALL_TAGS, [self.languages])[0]
        values, complete = _attribute(data, ALL_TAGS)
        self.assertTrue(complete)
        values = dict(zip(ALL_TAGS, values))
        self.assertIsNone(values[Tags.DESCRIPTION])
        self.assertIn(values[Tags.DESCRIPTION_ANY_LANGUAGE], ("Hallo", "Bonjour"))
