"""Tests for service/exif/main.py::get_tags.

No real exiftool binary is launched here: the module-level ``static_et`` /
``static_struct_et`` singletons are patched with fakes. The real binary is
exercised in ``test_exif_service_batching_real.py``.
"""

import json
from unittest.mock import patch

from django.test import SimpleTestCase

from service.exif import main as exif_main


class FakeExifTool:
    """Stand-in for exiftool.ExifTool.

    ``values`` maps (tag, file) to a value. A batched command answers each
    requested tag under the key ExifTool would use: the tag itself, or the
    one in ``renames`` (ExifTool files a tag under its canonical name, which
    is not always the name it was asked by). Files in ``unreadable`` are left
    out of a batched answer, as ExifTool does.
    """

    def __init__(
        self, values=None, running=False, raise_on=None, renames=None, unreadable=()
    ):
        self.values = values or {}
        self.running = running
        self.raise_on = raise_on or set()
        self.renames = renames or {}
        self.unreadable = set(unreadable)
        self.start_calls = 0
        self.calls = []
        self.batch_calls = []

    def start(self):
        self.start_calls += 1
        self.running = True

    def get_tag(self, tag, file):
        self.calls.append((tag, file))
        if (tag, file) in self.raise_on:
            raise RuntimeError("boom")
        return self.values.get((tag, file))

    def get_tags_batch(self, tags, files):
        self.batch_calls.append((list(tags), list(files)))
        if any((tag, file) in self.raise_on for tag in tags for file in files):
            raise RuntimeError("boom")
        answers = []
        for file in files:
            if file in self.unreadable:
                continue
            data = {"SourceFile": file}
            for tag in tags:
                value = self.values.get((tag, file))
                if value is not None:
                    data[self.renames.get(tag, tag)] = value
            answers.append(data)
        return answers


class GetTagsTest(SimpleTestCase):
    def setUp(self):
        exif_main.app.config["TESTING"] = True
        self.client = exif_main.app.test_client()

    def post(self, payload, raw=None, content_type="application/json"):
        if raw is not None:
            return self.client.post("/get-tags", data=raw, content_type=content_type)
        return self.client.post(
            "/get-tags", data=json.dumps(payload), content_type=content_type
        )

    def get_values(self, fake, files, tags, struct=False):
        target = "static_struct_et" if struct else "static_et"
        with patch.object(exif_main, target, fake):
            resp = self.post(
                {"files_by_reverse_priority": files, "tags": tags, "struct": struct}
            )
        self.assertEqual(resp.status_code, 201)
        return resp.get_json()["values"]

    # ------------------------------------------------------------------
    # one command per request
    # ------------------------------------------------------------------
    def test_values_come_back_in_tag_order(self):
        fake = FakeExifTool(
            values={("EXIF:Make", "/a.jpg"): "Canon", ("EXIF:Model", "/a.jpg"): "EOS"},
            running=True,
        )
        values = self.get_values(fake, ["/a.jpg"], ["EXIF:Model", "EXIF:Make"])
        self.assertEqual(values, ["EOS", "Canon"])
        self.assertEqual(fake.start_calls, 0)

    def test_every_tag_of_every_file_is_read_in_one_command(self):
        fake = FakeExifTool(
            values={("A", "/a.jpg"): 1, ("B", "/a.xmp"): 2, ("C", "/a.jpg"): 3},
            running=True,
        )
        values = self.get_values(fake, ["/a.jpg", "/a.xmp"], ["A", "B", "C"])
        self.assertEqual(values, [1, 2, 3])
        self.assertEqual(fake.batch_calls, [(["A", "B", "C"], ["/a.jpg", "/a.xmp"])])
        self.assertEqual(fake.calls, [])

    def test_last_file_with_a_value_wins(self):
        # Files are given in *reverse* priority: later files override earlier.
        fake = FakeExifTool(
            values={("T", "/low.jpg"): "low", ("T", "/high.jpg"): "high"},
            running=True,
        )
        values = self.get_values(fake, ["/low.jpg", "/high.jpg"], ["T"])
        self.assertEqual(values, ["high"])

    def test_later_file_without_the_tag_does_not_clear_it(self):
        fake = FakeExifTool(values={("T", "/a.jpg"): "kept"}, running=True)
        values = self.get_values(fake, ["/a.jpg", "/a.xmp"], ["T"])
        self.assertEqual(values, ["kept"])

    def test_tag_missing_everywhere_yields_none_without_a_second_command(self):
        fake = FakeExifTool(values={("A", "/a.jpg"): 1}, running=True)
        values = self.get_values(fake, ["/a.jpg"], ["A", "Nope"])
        self.assertEqual(values, [1, None])
        self.assertEqual(fake.calls, [])

    def test_empty_tags_returns_empty_values_without_calling_exiftool(self):
        fake = FakeExifTool(running=True)
        self.assertEqual(self.get_values(fake, ["/a.jpg"], []), [])
        self.assertEqual((fake.calls, fake.batch_calls), ([], []))

    def test_empty_file_list_yields_none_per_tag(self):
        fake = FakeExifTool(running=True)
        self.assertEqual(self.get_values(fake, [], ["A", "B"]), [None, None])
        self.assertEqual((fake.calls, fake.batch_calls), ([], []))

    # ------------------------------------------------------------------
    # mapping ExifTool's keys back to the requested tags
    # ------------------------------------------------------------------
    def test_ungrouped_tag_matches_any_group(self):
        fake = FakeExifTool(
            values={("Rating", "/a.jpg"): 4},
            renames={"Rating": "XMP:Rating"},
            running=True,
        )
        self.assertEqual(self.get_values(fake, ["/a.jpg"], ["Rating"]), [4])
        self.assertEqual(fake.calls, [])

    def test_ungrouped_tag_in_several_groups_takes_the_first(self):
        # What get_tag answered: the first value ExifTool listed.
        fake = FakeExifTool(running=True)
        fake.get_tags_batch = lambda tags, files: [
            {
                "SourceFile": "/a.RW2",
                "File:ImageWidth": 1920,
                "Composite:ImageWidth": 4592,
            }
        ]
        self.assertEqual(self.get_values(fake, ["/a.RW2"], ["ImageWidth"]), [1920])

    def test_family_1_group_matches_its_family_0_key(self):
        fake = FakeExifTool(
            values={("XMP-dc:Subject", "/a.jpg"): ["x"]},
            renames={"XMP-dc:Subject": "XMP:Subject"},
            running=True,
        )
        self.assertEqual(self.get_values(fake, ["/a.jpg"], ["XMP-dc:Subject"]), [["x"]])

    def test_same_name_in_another_group_is_not_taken(self):
        fake = FakeExifTool(
            values={("MakerNotes:SerialNumber", "/a.jpg"): "123"}, running=True
        )
        values = self.get_values(
            fake, ["/a.jpg"], ["EXIF:SerialNumber", "MakerNotes:SerialNumber"]
        )
        self.assertEqual(values, [None, "123"])

    def test_struct_answers_carry_no_group(self):
        fake = FakeExifTool(
            values={("XMP:RegionInfo", "/a.jpg"): {"RegionList": []}},
            renames={"XMP:RegionInfo": "RegionInfo"},
            running=True,
        )
        values = self.get_values(fake, ["/a.jpg"], ["XMP:RegionInfo"], struct=True)
        self.assertEqual(values, [{"RegionList": []}])

    def test_renamed_tag_is_asked_for_on_its_own(self):
        # ExifTool answers under a name we cannot attribute; get_tag took
        # whatever key came back, so that tag is read the old way.
        fake = FakeExifTool(
            values={("A", "/a.jpg"): 1, ("EXIF:Speed", "/a.jpg"): 100},
            renames={"EXIF:Speed": "EXIF:ISO"},
            running=True,
        )
        values = self.get_values(fake, ["/a.jpg"], ["A", "EXIF:Speed"])
        self.assertEqual(values, [1, 100])
        self.assertEqual(fake.calls, [("EXIF:Speed", "/a.jpg")])

    def test_unreadable_file_falls_back_to_per_tag_reads(self):
        # The batched answers no longer line up with the files.
        fake = FakeExifTool(
            values={("T", "/a.jpg"): "jpg", ("T", "/a.xmp"): "xmp"},
            unreadable={"/a.jpg"},
            running=True,
        )
        values = self.get_values(fake, ["/a.jpg", "/a.xmp"], ["T"])
        self.assertEqual(values, ["xmp"])
        self.assertEqual(fake.calls, [("T", "/a.jpg"), ("T", "/a.xmp")])

    # ------------------------------------------------------------------
    # instance selection / lifecycle
    # ------------------------------------------------------------------
    def test_struct_true_uses_struct_instance(self):
        plain = FakeExifTool(values={("T", "/a.jpg"): "plain"}, running=True)
        struct = FakeExifTool(values={("T", "/a.jpg"): "struct"}, running=True)
        with (
            patch.object(exif_main, "static_et", plain),
            patch.object(exif_main, "static_struct_et", struct),
        ):
            resp = self.post(
                {"files_by_reverse_priority": ["/a.jpg"], "tags": ["T"], "struct": True}
            )
        self.assertEqual(resp.get_json(), {"values": ["struct"]})
        self.assertEqual(plain.batch_calls, [])

    def test_struct_is_truthiness_based_not_boolean(self):
        plain = FakeExifTool(values={("T", "/a.jpg"): "plain"}, running=True)
        struct = FakeExifTool(values={("T", "/a.jpg"): "struct"}, running=True)
        with (
            patch.object(exif_main, "static_et", plain),
            patch.object(exif_main, "static_struct_et", struct),
        ):
            resp = self.post(
                {
                    "files_by_reverse_priority": ["/a.jpg"],
                    "tags": ["T"],
                    "struct": "yes",
                }
            )
        self.assertEqual(resp.get_json(), {"values": ["struct"]})

    def test_not_running_instance_is_started(self):
        fake = FakeExifTool(values={("T", "/a.jpg"): "v"}, running=False)
        self.assertEqual(self.get_values(fake, ["/a.jpg"], ["T"]), ["v"])
        self.assertEqual(fake.start_calls, 1)

    # ------------------------------------------------------------------
    # request validation branch -> 400
    # ------------------------------------------------------------------
    def test_missing_key_returns_400_empty_body(self):
        for payload in (
            {"tags": ["T"], "struct": False},
            {"files_by_reverse_priority": ["/a.jpg"], "struct": False},
            {"files_by_reverse_priority": ["/a.jpg"], "tags": ["T"]},
            {},
        ):
            with self.subTest(payload=payload):
                resp = self.post(payload)
                self.assertEqual(resp.status_code, 400)
                self.assertEqual(resp.get_data(as_text=True), "")

    def test_non_json_body_returns_400(self):
        resp = self.post(None, raw="not json", content_type="text/plain")
        self.assertEqual(resp.status_code, 400)
        self.assertEqual(resp.get_data(as_text=True), "")

    def test_malformed_json_returns_400(self):
        resp = self.post(None, raw="{oops", content_type="application/json")
        self.assertEqual(resp.status_code, 400)

    def test_json_null_body_returns_400(self):
        resp = self.post(None, raw="null", content_type="application/json")
        self.assertEqual(resp.status_code, 400)

    def test_get_method_not_allowed(self):
        self.assertEqual(self.client.get("/get-tags").status_code, 405)

    # ------------------------------------------------------------------
    # exiftool failure branch -> swallowed, still 201
    # ------------------------------------------------------------------
    def test_exiftool_error_is_swallowed_and_no_values_returned(self):
        # The reader pads a short answer with None, one per tag.
        fake = FakeExifTool(running=True, raise_on={("B", "/a.jpg")})
        with (
            patch.object(exif_main, "static_et", fake),
            patch.object(exif_main, "log") as log,
        ):
            resp = self.post(
                {
                    "files_by_reverse_priority": ["/a.jpg"],
                    "tags": ["A", "B", "C"],
                    "struct": False,
                }
            )
        self.assertEqual(resp.status_code, 201)
        self.assertEqual(resp.get_json(), {"values": []})
        log.assert_called_once_with("An error occurred")

    def test_start_failure_propagates_as_500(self):
        # et.start() is outside the try/except -> not swallowed.
        fake = FakeExifTool(running=False)

        def boom():
            raise RuntimeError("cannot start")

        fake.start = boom
        with patch.object(exif_main, "static_et", fake):
            with self.assertRaises(RuntimeError):
                self.post(
                    {
                        "files_by_reverse_priority": ["/a.jpg"],
                        "tags": ["T"],
                        "struct": False,
                    }
                )


class HealthAndLogTest(SimpleTestCase):
    def setUp(self):
        exif_main.app.config["TESTING"] = True
        self.client = exif_main.app.test_client()

    def test_health(self):
        resp = self.client.get("/health")
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.get_json(), {"status": "OK"})

    def test_log_prefixes_message(self):
        with patch("builtins.print") as p:
            exif_main.log("hello")
        p.assert_called_once_with("exif: hello")
