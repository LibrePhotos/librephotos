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
from unittest import mock

import exiftool
import PIL.Image
from django.test import SimpleTestCase

from api.metadata.photo_reader import EXIF_TAGS
from api.metadata.tags import Tags
from service.exif.main import (
    _attribute,
    highest_priority_value,
    highest_priority_values,
)

EXIFTOOL = shutil.which("exiftool")
FIXTURES = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "fixtures"
)
# Written, never read (#2297, #2289, #2290). The batched read files values by
# tag name, so it would answer a family-1 group like these with another
# group's tag, and MWG:Description and MWG:Keywords need a module the reader
# never loads.
WRITE_ONLY_TAGS = {
    Tags.ORIENTATION_XMP,
    Tags.DESCRIPTION_XMP,
    Tags.DESCRIPTION_MWG,
    Tags.KEYWORDS_MWG,
    Tags.GPS_LATITUDE_XMP,
    Tags.GPS_LONGITUDE_XMP,
    Tags.GPS_LATITUDE,
    Tags.GPS_LATITUDE_REF,
    Tags.GPS_LONGITUDE,
    Tags.GPS_LONGITUDE_REF,
    Tags.GPS_ALTITUDE_EXIF,
    Tags.GPS_ALTITUDE_REF,
    Tags.GPS_COORDINATES_KEYS,
    Tags.GPS_COORDINATES_USER_DATA,
    Tags.GPS_COORDINATES_ITEM_LIST,
}
ALL_TAGS = sorted(
    {value for name, value in vars(Tags).items() if name.isupper()} - WRITE_ONLY_TAGS
    | set(EXIF_TAGS)
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
        # A sidecar as a geotagger or a RAW editor writes it: the capture
        # date, position, camera and exposure under their exif:/tiff:/exifEX:
        # XMP names, which ExifTool reports as XMP:<Name> (#2261). The
        # position is south-west, so the signs must survive.
        cls.geotagged = os.path.join(cls.directory, "geotagged.xmp")
        subprocess.run(
            [
                EXIFTOOL,
                "-XMP-exif:DateTimeOriginal=2019:07:01 08:00:00+02:00",
                "-XMP-exif:GPSLatitude=33.9 S",
                "-XMP-exif:GPSLongitude=118.4 W",
                "-XMP-exif:GPSDateTime=2019:07:01 06:00:00Z",
                "-XMP-exif:FNumber=8",
                "-XMP-exif:ISO=1600",
                "-XMP-exif:ExposureTime=0.01",
                "-XMP-exif:FocalLength=50",
                "-XMP-exif:FocalLengthIn35mmFormat=75",
                "-XMP-tiff:Model=Sidecar Cam",
                "-XMP-exifEX:LensModel=Sidecar Lens",
                cls.geotagged,
            ],
            check=True,
            capture_output=True,
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

        # Every caption, title, creator, copyright and keyword source (#2266,
        # #2267), with a Rating so the ungrouped request shares the command.
        cls.text = os.path.join(cls.directory, "text.jpg")
        PIL.Image.new("RGB", (16, 12), (30, 20, 10)).save(cls.text)
        subprocess.run(
            [
                EXIFTOOL,
                "-overwrite_original",
                "-XMP:Rating=2",
                "-IPTC:Caption-Abstract=iptc caption",
                "-EXIF:ImageDescription=OLYMPUS DIGITAL CAMERA",
                "-XMP-dc:Title=xmp title",
                "-XMP-dc:Title-de=Titel",
                "-XMP-photoshop:Headline=xmp headline",
                "-IPTC:ObjectName=iptc object",
                "-IPTC:Headline=iptc headline",
                "-XMP-dc:Creator=Jane Doe",
                "-XMP-dc:Creator=John Roe",
                "-IPTC:By-line=iptc author",
                "-EXIF:Artist=exif artist",
                "-XMP-dc:Rights=(c) xmp",
                "-IPTC:CopyrightNotice=(c) iptc",
                "-EXIF:Copyright=(c) exif",
                "-XMP-iptcExt:PersonInImage=Alice",
                "-XMP-iptcExt:PersonInImage=Bob",
                "-XMP-lr:HierarchicalSubject=Places|USA|San Francisco",
                cls.text,
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
            [self.camera, self.geotagged],
            [self.geotagged],
            [os.path.join(FIXTURES, "niaz.jpg"), os.path.join(FIXTURES, "niaz.xmp")],
            [os.path.join(FIXTURES, "iptc_test.jpg")],
            [self.languages],
            [self.text],
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

    def test_sidecar_values_under_their_xmp_names_win(self):
        values = dict(
            zip(
                ALL_TAGS,
                highest_priority_values(
                    self.plain, ALL_TAGS, [self.camera, self.geotagged]
                ),
            )
        )
        self.assertEqual(values[Tags.DATE_TIME_ORIGINAL], "2019:07:01 08:00:00+02:00")
        self.assertEqual(values[Tags.LATITUDE], -33.9)
        self.assertEqual(values[Tags.LONGITUDE], -118.4)
        self.assertEqual(values[Tags.GPS_DATE_TIME], "2019:07:01 06:00:00Z")
        self.assertEqual(values[Tags.CAMERA], "Sidecar Cam")
        self.assertEqual(values[Tags.LENS], "Sidecar Lens")
        self.assertEqual(values[Tags.FSTOP], 8)
        self.assertEqual(values[Tags.ISO], 1600)
        self.assertEqual(values[Tags.EXPOSURE_TIME], 0.01)
        self.assertEqual(values[Tags.FOCAL_LENGTH], 50)
        self.assertEqual(values[Tags.FOCAL_LENGTH_35MM], 75)
        # Not in the sidecar: the media file's own values stay.
        self.assertEqual(values[Tags.RATING], 3)
        self.assertEqual(values[Tags.SUBSEC_TIME_ORIGINAL], 123)

    def test_a_sidecar_without_those_properties_keeps_the_embedded_values(self):
        values = dict(
            zip(
                ALL_TAGS,
                highest_priority_values(
                    self.plain, ALL_TAGS, [self.camera, self.sidecar]
                ),
            )
        )
        self.assertEqual(values[Tags.DATE_TIME_ORIGINAL], "2021:07:04 12:30:00")
        self.assertEqual(values[Tags.LATITUDE], 48.137)
        self.assertEqual(values[Tags.CAMERA], "Test Cam")
        self.assertEqual(values[Tags.FSTOP], 2.8)

    def test_an_embedded_xmp_property_does_not_override_the_exif_value(self):
        # The XMP names are asked for every file in the one command, but only
        # a sidecar answers with them: inside the media file EXIF stays the source.
        jpeg = os.path.join(self.directory, "embedded-xmp.jpg")
        shutil.copyfile(self.camera, jpeg)
        subprocess.run(
            [EXIFTOOL, "-overwrite_original", "-XMP-tiff:Model=Embedded XMP", jpeg],
            check=True,
            capture_output=True,
        )
        values = dict(
            zip(ALL_TAGS, highest_priority_values(self.plain, ALL_TAGS, [jpeg]))
        )
        self.assertEqual(values[Tags.CAMERA], "Test Cam")

    def test_one_exiftool_command_per_request(self):
        files = [self.camera, self.geotagged]
        with mock.patch.object(
            self.plain, "execute_json", wraps=self.plain.execute_json
        ) as execute_json:
            highest_priority_values(self.plain, ALL_TAGS, files)
        self.assertEqual(execute_json.call_count, 1)

    def test_text_tags_are_answered_by_the_batch(self):
        # No new tag may come back under a key the batch cannot place, or every
        # such file would fall back to one command per tag.
        for et in (self.plain, self.struct):
            with self.subTest(struct=et is self.struct):
                data = et.get_tags_batch(ALL_TAGS, [self.text])[0]
                values, complete = _attribute(data, ALL_TAGS)
                self.assertTrue(complete)
                values = dict(zip(ALL_TAGS, values))
                self.assertEqual(values[Tags.RATING], 2)
                self.assertEqual(values[Tags.IPTC_CAPTION], "iptc caption")
                self.assertEqual(values[Tags.TITLE], "xmp title")
                self.assertEqual(values[Tags.XMP_CREATOR], ["Jane Doe", "John Roe"])
                self.assertEqual(values[Tags.IPTC_COPYRIGHT], "(c) iptc")
                self.assertEqual(values[Tags.PERSON_IN_IMAGE], ["Alice", "Bob"])
                # -struct keeps a one-entry list a list.
                self.assertIn(
                    values[Tags.HIERARCHICAL_SUBJECT],
                    ("Places|USA|San Francisco", ["Places|USA|San Francisco"]),
                )
