"""The exif sidecar's /all-tags route (#2277): every tag of one file, grouped.

The route and its grouping are tested with a fake first; ``AllTagsRealExifToolTest``
reads a JPEG and its XMP sidecar with the real ExifTool.
"""

import os
import shutil
import subprocess
import tempfile
import unittest
from unittest.mock import patch

import exiftool
import PIL.Image
from django.test import SimpleTestCase

from service.exif import main as exif_main
from service.exif.all_tags import FileNotReadableError, group_tags, read_all_tags

EXIFTOOL = shutil.which("exiftool")


class GroupTagsTest(SimpleTestCase):
    def test_tags_are_grouped_by_family_1_group_in_exiftools_order(self):
        groups = group_tags(
            {
                "SourceFile": "/library/a.jpg",
                "File:FileType": "JPEG",
                "EXIF:IFD0:Make": "FUJIFILM",
                "EXIF:ExifIFD:ISO": "200",
                "EXIF:IFD0:Model": "X-T5",
                "MakerNotes:FujiFilm:FilmMode": "Classic Chrome",
            }
        )
        self.assertEqual(
            groups,
            [
                {"name": "File", "family": "File", "tags": {"FileType": "JPEG"}},
                {
                    "name": "IFD0",
                    "family": "EXIF",
                    "tags": {"Make": "FUJIFILM", "Model": "X-T5"},
                },
                {"name": "ExifIFD", "family": "EXIF", "tags": {"ISO": "200"}},
                {
                    "name": "FujiFilm",
                    "family": "MakerNotes",
                    "tags": {"FilmMode": "Classic Chrome"},
                },
            ],
        )

    def test_the_tags_of_a_group_are_sorted_by_name(self):
        (group,) = group_tags(
            {"EXIF:IFD0:Model": "X-T5", "EXIF:IFD0:artist": "A", "EXIF:IFD0:Make": "F"}
        )
        self.assertEqual(list(group["tags"]), ["artist", "Make", "Model"])

    def test_the_file_system_and_exiftool_groups_are_dropped(self):
        groups = group_tags(
            {
                "ExifTool:ExifToolVersion": "13.57",
                "File:System:FileName": "a.jpg",
                "File:System:Directory": "/library/private",
                "File:MIMEType": "image/jpeg",
            }
        )
        self.assertEqual(
            groups,
            [{"name": "File", "family": "File", "tags": {"MIMEType": "image/jpeg"}}],
        )

    def test_a_key_without_a_group_is_kept(self):
        self.assertEqual(
            group_tags({"Make": "x"}),
            [{"name": "", "family": "", "tags": {"Make": "x"}}],
        )


class FakeExifTool:
    def __init__(self, output: bytes = b"") -> None:
        self.output = output
        self.running = True
        self.params: tuple[bytes, ...] = ()

    def execute(self, *params: bytes) -> bytes:
        self.params = params
        return self.output


class ReadAllTagsTest(SimpleTestCase):
    def test_reads_one_file_with_groups_and_print_conversion(self):
        fake = FakeExifTool(b'[{"SourceFile": "/x.jpg", "EXIF:IFD0:Make": "Canon"}]')
        groups = read_all_tags(fake, "/x.jpg")
        self.assertEqual(groups[0]["tags"], {"Make": "Canon"})
        self.assertEqual(
            fake.params,
            (b"-j", b"-G0:1", b"-a", b"-api", b"StructFormat=JSONQ", b"/x.jpg"),
        )
        self.assertNotIn(b"-n", fake.params)

    def test_no_answer_means_the_file_is_not_readable(self):
        with self.assertRaises(FileNotReadableError):
            read_all_tags(FakeExifTool(b""), "/x.jpg")

    def test_an_unexpected_answer_is_an_error(self):
        for output in (b"[]", b"[1]", b"{}", b"not json"):
            with self.subTest(output=output), self.assertRaises(ValueError):
                read_all_tags(FakeExifTool(output), "/x.jpg")

    def test_latin_1_output_is_decoded(self):
        fake = FakeExifTool('[{"EXIF:IFD0:Artist": "Jos\xe9"}]'.encode("latin-1"))
        self.assertEqual(
            read_all_tags(fake, "/x.jpg")[0]["tags"], {"Artist": "Jos\xe9"}
        )


class AllTagsRouteTest(SimpleTestCase):
    def setUp(self):
        exif_main.app.config["TESTING"] = True
        self.client = exif_main.app.test_client()
        self.directory = tempfile.mkdtemp(prefix="librephotos-all-tags-")
        self.addCleanup(shutil.rmtree, self.directory, True)
        self.path = os.path.join(self.directory, "a.jpg")
        with open(self.path, "wb") as file:
            file.write(b"not really a jpeg")
        self.fake = FakeExifTool(b'[{"EXIF:IFD0:Make": "Canon"}]')
        patcher = patch.object(exif_main, "static_struct_et", self.fake)
        patcher.start()
        self.addCleanup(patcher.stop)

    def test_answers_the_groups_of_the_file(self):
        response = self.client.post("/all-tags", json={"path": self.path})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            response.get_json(),
            {"groups": [{"name": "IFD0", "family": "EXIF", "tags": {"Make": "Canon"}}]},
        )

    def test_refuses_a_request_without_one_absolute_path(self):
        for body in (
            {},
            {"path": 3},
            {"path": "relative.jpg"},
            {"path": "-o"},
            {"path": self.path + "\n-execute"},
        ):
            with self.subTest(body=body):
                response = self.client.post("/all-tags", json=body)
                self.assertEqual(response.status_code, 400)
        self.assertEqual(self.fake.params, ())

    def test_a_missing_file_is_a_404(self):
        response = self.client.post(
            "/all-tags", json={"path": os.path.join(self.directory, "gone.jpg")}
        )
        self.assertEqual(response.status_code, 404)

    def test_a_file_exiftool_answers_nothing_for_is_a_404(self):
        self.fake.output = b""
        response = self.client.post("/all-tags", json={"path": self.path})
        self.assertEqual(response.status_code, 404)

    def test_an_exiftool_failure_is_a_500_without_the_path(self):
        self.fake.output = b"[]"
        with self.assertLogs("exif", level="ERROR") as logs:
            response = self.client.post("/all-tags", json={"path": self.path})
        self.assertEqual(response.status_code, 500)
        self.assertIn("error", response.get_json())
        self.assertNotIn(self.directory, "\n".join(logs.output))


@unittest.skipUnless(EXIFTOOL, "exiftool binary not available")
class AllTagsRealExifToolTest(SimpleTestCase):
    """A JPEG with a camera, a thumbnail and an XMP sidecar, read by ExifTool."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.struct = exiftool.ExifTool(EXIFTOOL, common_args=["-struct"])
        cls.struct.start()
        cls.addClassCleanup(cls.struct.terminate)
        cls.directory = tempfile.mkdtemp(prefix="librephotos-all-tags-real-")
        cls.addClassCleanup(shutil.rmtree, cls.directory, True)

        cls.photo = os.path.join(cls.directory, "IMG_1.jpg")
        thumbnail = os.path.join(cls.directory, "thumb.jpg")
        PIL.Image.new("RGB", (64, 48), (90, 60, 30)).save(cls.photo)
        PIL.Image.new("RGB", (16, 12), (10, 10, 10)).save(thumbnail)
        subprocess.run(
            [
                EXIFTOOL,
                "-overwrite_original",
                "-IFD0:Make=Fujifilm",
                "-ExifIFD:ExposureTime=0.004",
                "-ExifIFD:ExifVersion=0232",
                f"-ThumbnailImage<={thumbnail}",
                "-XMP-mwg-rs:RegionInfo={RegionList=[{Name=Anna,Type=Face}]}",
                cls.photo,
            ],
            check=True,
            capture_output=True,
        )
        cls.sidecar = os.path.join(cls.directory, "IMG_1.jpg.xmp")
        subprocess.run(
            [EXIFTOOL, "-XMP-xmp:Rating=4", cls.sidecar],
            check=True,
            capture_output=True,
        )

    def setUp(self):
        exif_main.app.config["TESTING"] = True
        self.client = exif_main.app.test_client()
        patcher = patch.object(exif_main, "static_struct_et", self.struct)
        patcher.start()
        self.addCleanup(patcher.stop)

    def groups_of(self, path: str) -> dict[str, dict[str, object]]:
        response = self.client.post("/all-tags", json={"path": path})
        self.assertEqual(response.status_code, 200, response.get_json())
        return {group["name"]: group for group in response.get_json()["groups"]}

    def test_the_media_file_reads_with_print_conversion(self):
        groups = self.groups_of(self.photo)
        self.assertEqual(groups["IFD0"]["family"], "EXIF")
        self.assertEqual(groups["IFD0"]["tags"]["Make"], "Fujifilm")
        # Print conversion on, and numbers as ExifTool prints them.
        self.assertEqual(groups["ExifIFD"]["tags"]["ExposureTime"], "1/250")
        self.assertEqual(groups["ExifIFD"]["tags"]["ExifVersion"], "0232")
        # Binary payloads keep ExifTool's placeholder.
        self.assertRegex(
            groups["IFD1"]["tags"]["ThumbnailImage"], r"^\(Binary data \d+ bytes"
        )
        # Structures stay structures (-struct).
        region = groups["XMP-mwg-rs"]["tags"]["RegionInfo"]
        self.assertEqual(region["RegionList"][0]["Name"], "Anna")

    def test_the_file_system_and_exiftool_groups_are_left_out(self):
        groups = self.groups_of(self.photo)
        self.assertNotIn("System", groups)
        self.assertNotIn("ExifTool", groups)
        self.assertNotIn(self.directory, str(groups))

    def test_the_sidecar_reads_on_its_own(self):
        groups = self.groups_of(self.sidecar)
        self.assertEqual(groups["XMP-xmp"]["tags"]["Rating"], "4")
        self.assertNotIn("IFD0", groups)

    def test_the_options_do_not_stay_on_the_shared_process(self):
        self.groups_of(self.photo)
        # The struct process serves /get-tags too: no group prefix leaks into it.
        self.assertEqual(self.struct.get_tag("Make", self.photo), "Fujifilm")
        answer = self.struct.execute_json("-Make", self.photo)
        self.assertIn("Make", answer[0])
