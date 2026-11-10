"""The exif sidecar answers as it did on PyExifTool 0.4.9 (real ExifTool, no mocks).

When api.metadata.exiftool_client replaced PyExifTool, the sidecar's answers
for a set of test files were captured from both and compared: identical but
for the error message of an unreadable file, which now says why. The expected
values below are the PyExifTool answers. They cover grouped numeric reads,
``-struct`` reads, a sidecar overriding its media file, a non-ASCII file name
and text that is not valid UTF-8 (ExifTool prints ``?`` for those bytes).
"""

import os
import shutil
import subprocess
import tempfile
import unittest

import PIL.Image
from django.test import SimpleTestCase

from service.exif import main as exif_main

EXIFTOOL = shutil.which("exiftool")

TAGS = [
    "EXIF:DateTimeOriginal", "EXIF:OffsetTimeOriginal", "QuickTime:CreateDate",
    "EXIF:Make", "EXIF:Model", "QuickTime:Model", "EXIF:Orientation", "Orientation",
    "EXIF:GPSLatitude", "EXIF:GPSLongitude", "Composite:GPSLatitude",
    "Composite:GPSLongitude", "EXIF:GPSAltitude", "EXIF:ExposureTime", "EXIF:FNumber",
    "EXIF:ISO", "EXIF:FocalLength", "EXIF:Artist", "XMP:Description",
    "XMP:Description-*", "XMP-dc:Description", "XMP-dc:Subject", "XMP:Subject",
    "IPTC:Keywords", "IPTC:Caption-Abstract", "EXIF:ImageDescription", "XMP:Rating",
    "Rating", "XMP-dc:Title", "File:ImageWidth", "ImageWidth", "ImageHeight",
    "MIMEType", "Keys:GPSCoordinates", "Composite:GPSPosition", "Bogus:NotATag",
    "Duration",
]  # fmt: skip
STRUCT_TAGS = [
    "RegionInfo", "XMP:RegionInfo", "Subject", "Description", "Make", "Model",
    "DateTimeOriginal",
]  # fmt: skip

FULL_ARGUMENTS = [
    "-EXIF:DateTimeOriginal=2021:07:04 12:34:56",
    "-EXIF:OffsetTimeOriginal=+02:00",
    "-EXIF:Make=Canon",
    "-EXIF:Model=EOS R5",
    "-EXIF:Orientation#=6",
    "-EXIF:GPSLatitude=52.520008",
    "-EXIF:GPSLatitudeRef=N",
    "-EXIF:GPSLongitude=13.404954",
    "-EXIF:GPSLongitudeRef=E",
    "-EXIF:GPSAltitude=34.5",
    "-EXIF:ExposureTime=0.004",
    "-EXIF:FNumber=2.8",
    "-EXIF:ISO=400",
    "-EXIF:FocalLength=35",
    "-EXIF:Artist=Zoë Ünïcode",
    "-XMP-dc:Description-x-default=A café in Berlin",
    "-XMP-dc:Description-de=Ein Café in Berlin",
    "-XMP-dc:Subject=Straße",
    "-XMP-dc:Subject+=日本",
    "-XMP-dc:Subject+=emoji 📷",
    "-XMP-xmp:Rating=4",
    '-XMP-dc:Title=Title with "quotes" and \\backslash',
    "-IPTC:Keywords=alpha",
    "-IPTC:Keywords+=beta",
    "-XMP-mwg-rs:RegionInfo={AppliedToDimensions={W=96,H=64,Unit=pixel},"
    "RegionList=[{Area={X=0.5,Y=0.5,W=0.2,H=0.3,Unit=normalized},Name=Zoë,Type=Face}]}",
]
REGION = {
    "AppliedToDimensions": {"H": 64, "Unit": "pixel", "W": 96},
    "RegionList": [
        {
            "Area": {"H": 0.3, "Unit": "normalized", "W": 0.2, "X": 0.5, "Y": 0.5},
            "Name": "Zoë",
            "Type": "Face",
        }
    ],
}


def expected(values: dict[str, object]) -> list[object]:
    """The answer for ``TAGS``: ``values`` where given, else None."""
    return [values.get(tag) for tag in TAGS]


@unittest.skipUnless(EXIFTOOL, "exiftool binary not available")
class ExifServiceGoldenTest(SimpleTestCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.directory = tempfile.mkdtemp(prefix="librephotos-exif-golden-")
        cls.addClassCleanup(shutil.rmtree, cls.directory, True)
        cls.full = cls.image("日本語 写真.jpg")
        cls.tag(cls.full, *FULL_ARGUMENTS)
        cls.latin = cls.image("latin1.jpg")
        cls.tag(
            cls.latin, "-charset", "iptc=latin1", "-IPTC:Caption-Abstract=José Müller"
        )
        cls.tag(cls.latin, "-IPTC:CodedCharacterSet=")
        cls.raw = os.path.join(cls.directory, "rawbytes.jpg")
        exif = PIL.Image.Exif()
        exif[0x010E] = "caf\xe9 cr\xe8me".encode("latin-1")  # ImageDescription
        exif[0x013B] = b"Art\xff\xfeist"  # Artist
        PIL.Image.new("RGB", (96, 64), (9, 9, 9)).save(cls.raw, exif=exif.tobytes())
        cls.sided = cls.image("sided.jpg")
        cls.tag(
            cls.sided, "-EXIF:DateTimeOriginal=2010:01:01 00:00:00", "-EXIF:Make=Nikon"
        )
        cls.sidecar = os.path.join(cls.directory, "sided.xmp")
        cls.tag(
            cls.sidecar,
            "-XMP-exif:DateTimeOriginal=2011:02:03 04:05:06",
            "-XMP-tiff:Make=Sony",
            "-XMP-dc:Subject=from sidecar",
            create=True,
        )
        exif_main.app.config["TESTING"] = True
        exif_main.stop_exiftools()
        cls.addClassCleanup(exif_main.stop_exiftools)

    @classmethod
    def image(cls, name: str) -> str:
        path = os.path.join(cls.directory, name)
        PIL.Image.new("RGB", (96, 64), (200, 30, 30)).save(path)
        return path

    @classmethod
    def tag(cls, path: str, *arguments: str, create: bool = False) -> None:
        # Through an argument file: a Windows command line loses non-ASCII text.
        argfile = os.path.join(cls.directory, "arguments.txt")
        target = ["-o", path] if create else ["-overwrite_original", path]
        with open(argfile, "w", encoding="utf-8") as handle:
            handle.write("\n".join(["-charset", "filename=utf8", *arguments, *target]))
        subprocess.run([EXIFTOOL, "-@", argfile], check=True, capture_output=True)

    def get_tags(self, files: list[str], tags: list[str], **options: object) -> dict:
        response = exif_main.app.test_client().post(
            "/get-tags",
            json={
                "files_by_reverse_priority": files,
                "tags": tags,
                "struct": False,
                **options,
            },
        )
        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        return response.get_json()

    def test_grouped_numeric_values_of_a_file_with_a_non_ascii_name(self):
        answer = self.get_tags([self.full], TAGS, origins=True)
        values = [
            "2021:07:04 12:34:56", "+02:00", None, "Canon", "EOS R5", None, 6, 6,
            52.520008, 13.404954, 52.520008, 13.404954, 34.5, 0.004, 2.8, 400, 35,
            "Zoë Ünïcode", "A café in Berlin", "Ein Café in Berlin", "A café in Berlin",
            ["Straße", "日本", "emoji 📷"], ["Straße", "日本", "emoji 📷"],
            ["alpha", "beta"], None, None, 4, 4, 'Title with "quotes" and \\backslash',
            96, 96, 64, "image/jpeg", None, "52.520008 13.404954", None, None,
        ]  # fmt: skip
        self.assertEqual(answer["values"], values)
        self.assertEqual(
            answer["origins"], [None if value is None else 0 for value in values]
        )

    def test_struct_values(self):
        answer = self.get_tags([self.full], STRUCT_TAGS, struct=True)
        self.assertEqual(
            answer["values"],
            [
                REGION,
                REGION,
                ["Straße", "日本", "emoji 📷"],
                "A café in Berlin",
                "Canon",
                "EOS R5",
                "2021:07:04 12:34:56",
            ],
        )

    def test_the_sidecar_overrides_the_media_file(self):
        answer = self.get_tags([self.sided, self.sidecar], TAGS, origins=True)
        self.assertEqual(
            answer["values"],
            expected(
                {
                    "EXIF:DateTimeOriginal": "2011:02:03 04:05:06",
                    "EXIF:Make": "Sony",
                    "XMP-dc:Subject": "from sidecar",
                    "XMP:Subject": "from sidecar",
                    "File:ImageWidth": 96,
                    "ImageWidth": 96,
                    "ImageHeight": 64,
                    "MIMEType": "application/rdf+xml",
                }
            ),
        )
        origins = answer["origins"]
        self.assertEqual(origins[TAGS.index("EXIF:Make")], 1)
        self.assertEqual(origins[TAGS.index("ImageWidth")], 0)
        self.assertEqual(origins[TAGS.index("MIMEType")], 1)

    def test_text_that_is_not_utf8(self):
        self.assertEqual(
            self.get_tags([self.raw], TAGS)["values"],
            expected(
                {
                    "EXIF:Artist": "Art??ist",
                    "EXIF:ImageDescription": "caf? cr?me",
                    "File:ImageWidth": 96,
                    "ImageWidth": 96,
                    "ImageHeight": 64,
                    "MIMEType": "image/jpeg",
                }
            ),
        )
        self.assertEqual(
            self.get_tags([self.latin], TAGS)["values"],
            expected(
                {
                    "IPTC:Caption-Abstract": "José Müller",
                    "File:ImageWidth": 96,
                    "ImageWidth": 96,
                    "ImageHeight": 64,
                    "MIMEType": "image/jpeg",
                }
            ),
        )

    def test_all_tags_of_text_that_is_not_utf8(self):
        response = exif_main.app.test_client().post(
            "/all-tags", json={"path": self.raw}
        )
        groups = {
            group["name"]: group["tags"] for group in response.get_json()["groups"]
        }
        self.assertEqual(
            groups["IFD0"], {"Artist": "Art??ist", "ImageDescription": "caf? cr?me"}
        )
        self.assertEqual(
            groups["Composite"], {"ImageSize": "96x64", "Megapixels": "0.006"}
        )

    def test_an_unreadable_file_is_an_error_that_says_why_without_the_path(self):
        missing = os.path.join(self.directory, "gone.jpg")
        response = exif_main.app.test_client().post(
            "/get-tags",
            json={
                "files_by_reverse_priority": [missing],
                "tags": ["EXIF:Make"],
                "struct": False,
            },
        )
        self.assertEqual(response.status_code, 500)
        self.assertEqual(
            response.get_json(), {"error": "Error: File not found - the file"}
        )

    def test_geolocate(self):
        response = exif_main.app.test_client().post(
            "/geolocate",
            json={
                "points": [{"lat": 52.52, "lon": 13.405}, {"lat": 0.0, "lon": -30.0}],
                "max_distance_km": 50,
            },
        )
        self.assertEqual(
            response.get_json(),
            {
                "places": [
                    {
                        "GeolocationCity": "Berlin",
                        "GeolocationCountry": "Germany",
                        "GeolocationCountryCode": "DE",
                        "GeolocationDistance": 0.62,
                        "GeolocationFeatureCode": "PPLC",
                        "GeolocationPosition": "52.5244 13.4105",
                        "GeolocationRegion": "State of Berlin",
                    },
                    None,
                ]
            },
        )
