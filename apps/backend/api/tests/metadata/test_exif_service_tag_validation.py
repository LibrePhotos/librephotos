"""The exif sidecar refuses tag names and paths that would let a user's
``burst_detection_rules`` / ``datetime_rules`` turn a metadata read into an
ExifTool write, rename or option injection.

This is the sidecar's own defense in depth; the serializer (tested in
api.tests.users_and_auth.test_rules_exif_tag_injection) already stops such a
rule from being saved. No real exiftool binary is launched: the module-level
singletons are patched with the same fake used by test_exif_service_get_tags.
"""

import json
from unittest.mock import patch

from django.test import SimpleTestCase

from service.exif import main as exif_main
from service.exif.tag_validation import is_safe_media_path, is_safe_tag_name

from api.tests.metadata.test_exif_service_get_tags import FakeExifTool


class GetTagsSecurityTest(SimpleTestCase):
    def setUp(self):
        exif_main.app.config["TESTING"] = True
        self.client = exif_main.app.test_client()

    def post(self, files, tags, struct=False):
        return self.client.post(
            "/get-tags",
            data=json.dumps(
                {
                    "files_by_reverse_priority": files,
                    "tags": tags,
                    "struct": struct,
                }
            ),
            content_type="application/json",
        )

    def get_values(self, fake, files, tags):
        with patch.object(exif_main, "static_et", fake):
            resp = self.post(files, tags)
        self.assertEqual(resp.status_code, 200)
        return resp, fake

    def test_unsafe_tag_is_dropped_and_never_reaches_exiftool(self):
        fake = FakeExifTool(values={("EXIF:Model", "/a.jpg"): "EOS"}, running=True)
        resp, fake = self.get_values(
            fake, ["/a.jpg"], ["EXIF:Model", "FileName=../evil.jpg", "EXIF:Make"]
        )
        # The rename tag comes back as None, in its requested position; the
        # real tags still resolve.
        self.assertEqual(resp.get_json()["values"], ["EOS", None, None])
        # ExifTool was only ever asked for the safe tags.
        self.assertEqual(fake.batch_calls, [(["EXIF:Model", "EXIF:Make"], ["/a.jpg"])])
        for tags, _files in fake.batch_calls:
            self.assertNotIn("FileName=../evil.jpg", tags)

    def test_newline_injection_tag_is_dropped(self):
        fake = FakeExifTool(running=True)
        resp, fake = self.get_values(
            fake, ["/a.jpg"], ["EXIF:Model\n-if\nopen(F,'>x');1\n-FileSize"]
        )
        self.assertEqual(resp.get_json()["values"], [None])
        self.assertEqual(fake.batch_calls, [])
        self.assertEqual(fake.calls, [])

    def test_all_tags_unsafe_returns_none_per_tag_without_calling_exiftool(self):
        fake = FakeExifTool(running=True)
        resp, fake = self.get_values(fake, ["/a.jpg"], ["all=", "-if"])
        self.assertEqual(resp.get_json()["values"], [None, None])
        self.assertEqual((fake.calls, fake.batch_calls), ([], []))

    def test_line_break_in_a_path_is_refused(self):
        fake = FakeExifTool(running=True)
        with patch.object(exif_main, "static_et", fake):
            resp = self.post(["/a.jpg\n-if\n1"], ["EXIF:Model"])
        self.assertEqual(resp.status_code, 400)
        self.assertEqual((fake.calls, fake.batch_calls), ([], []))

    def test_safe_tags_are_unaffected(self):
        fake = FakeExifTool(
            values={
                ("EXIF:Model", "/a.jpg"): "EOS",
                ("XMP-dc:Description-*", "/a.jpg"): "hi",
            },
            running=True,
        )
        resp, fake = self.get_values(
            fake, ["/a.jpg"], ["EXIF:Model", "XMP-dc:Description-*"]
        )
        self.assertEqual(resp.get_json()["values"], ["EOS", "hi"])


class TagValidationUnitTest(SimpleTestCase):
    def test_accepts_real_tag_names(self):
        for tag in [
            "EXIF:Model",
            "XMP:DateCreated",
            "QuickTime:CreateDate",
            "Composite:GPSDateTime",
            "MakerNotes:BurstMode",
            "XMP-dc:Description",
            "XMP:Description-*",
            "ImageWidth",
            "EXIF:FocalLengthIn35mmFormat",
        ]:
            self.assertTrue(is_safe_tag_name(tag), tag)

    def test_rejects_injection_tags(self):
        for tag in [
            "EXIF:Model=1",
            "FileName=../evil.jpg",
            "all=",
            "EXIF:Model\n-if\n1",
            "EXIF:Model\r-o",
            "-if",
            ":leadingcolon",
            "has space",
            "",
            "x" * 129,
            None,
            123,
        ]:
            self.assertFalse(is_safe_tag_name(tag), repr(tag))

    def test_rejects_paths_with_line_breaks(self):
        self.assertTrue(is_safe_media_path("/data/photos/a.jpg"))
        self.assertFalse(is_safe_media_path("/data/a.jpg\n-if\n1"))
        self.assertFalse(is_safe_media_path("/data/a.jpg\r-o"))
        self.assertFalse(is_safe_media_path(None))
