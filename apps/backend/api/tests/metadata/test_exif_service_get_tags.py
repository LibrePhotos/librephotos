"""Characterization tests for service/exif/main.py::get_tags.

These pin the CURRENT observed behavior of the exif microservice endpoint
before refactoring. No real exiftool binary is ever launched: the module-level
``static_et`` / ``static_struct_et`` singletons are patched with fakes.
"""

import json
from unittest.mock import patch

from django.test import SimpleTestCase

from service.exif import main as exif_main


class FakeExifTool:
    """Stand-in for exiftool.ExifTool with a scripted get_tag."""

    def __init__(self, values=None, running=False, raise_on=None):
        # values: {(tag, file): value}
        self.values = values or {}
        self.running = running
        self.raise_on = raise_on or set()
        self.start_calls = 0
        self.calls = []

    def start(self):
        self.start_calls += 1
        self.running = True

    def get_tag(self, tag, file):
        self.calls.append((tag, file))
        if (tag, file) in self.raise_on:
            raise RuntimeError("boom")
        return self.values.get((tag, file))


class GetTagsCharacterizationTest(SimpleTestCase):
    def setUp(self):
        exif_main.app.config["TESTING"] = True
        self.client = exif_main.app.test_client()

    def post(self, payload, raw=None, content_type="application/json"):
        if raw is not None:
            return self.client.post("/get-tags", data=raw, content_type=content_type)
        return self.client.post(
            "/get-tags", data=json.dumps(payload), content_type=content_type
        )

    # ------------------------------------------------------------------
    # happy path
    # ------------------------------------------------------------------
    def test_happy_path_returns_201_and_values_in_tag_order(self):
        fake = FakeExifTool(
            values={
                ("EXIF:Make", "/a.jpg"): "Canon",
                ("EXIF:Model", "/a.jpg"): "EOS",
            },
            running=True,
        )
        with patch.object(exif_main, "static_et", fake):
            resp = self.post(
                {
                    "files_by_reverse_priority": ["/a.jpg"],
                    "tags": ["EXIF:Make", "EXIF:Model"],
                    "struct": False,
                }
            )

        self.assertEqual(resp.status_code, 201)
        self.assertEqual(resp.get_json(), {"values": ["Canon", "EOS"]})
        self.assertEqual(fake.start_calls, 0)

    def test_last_file_with_non_none_value_wins(self):
        # Files are given in *reverse* priority: later files override earlier.
        fake = FakeExifTool(
            values={
                ("T", "/low.jpg"): "low",
                ("T", "/high.jpg"): "high",
            },
            running=True,
        )
        with patch.object(exif_main, "static_et", fake):
            resp = self.post(
                {
                    "files_by_reverse_priority": ["/low.jpg", "/high.jpg"],
                    "tags": ["T"],
                    "struct": False,
                }
            )

        self.assertEqual(resp.get_json(), {"values": ["high"]})
        # every file is probed, even after a hit
        self.assertEqual(fake.calls, [("T", "/low.jpg"), ("T", "/high.jpg")])

    def test_later_none_does_not_clear_earlier_value(self):
        fake = FakeExifTool(values={("T", "/a.jpg"): "kept"}, running=True)
        with patch.object(exif_main, "static_et", fake):
            resp = self.post(
                {
                    "files_by_reverse_priority": ["/a.jpg", "/missing.jpg"],
                    "tags": ["T"],
                    "struct": False,
                }
            )
        self.assertEqual(resp.get_json(), {"values": ["kept"]})

    def test_tag_missing_everywhere_yields_none(self):
        fake = FakeExifTool(running=True)
        with patch.object(exif_main, "static_et", fake):
            resp = self.post(
                {
                    "files_by_reverse_priority": ["/a.jpg"],
                    "tags": ["Nope"],
                    "struct": False,
                }
            )
        self.assertEqual(resp.status_code, 201)
        self.assertEqual(resp.get_json(), {"values": [None]})

    def test_empty_tags_returns_empty_values_without_calling_exiftool(self):
        fake = FakeExifTool(running=True)
        with patch.object(exif_main, "static_et", fake):
            resp = self.post(
                {
                    "files_by_reverse_priority": ["/a.jpg"],
                    "tags": [],
                    "struct": False,
                }
            )
        self.assertEqual(resp.status_code, 201)
        self.assertEqual(resp.get_json(), {"values": []})
        self.assertEqual(fake.calls, [])

    def test_empty_file_list_yields_none_per_tag(self):
        fake = FakeExifTool(running=True)
        with patch.object(exif_main, "static_et", fake):
            resp = self.post(
                {
                    "files_by_reverse_priority": [],
                    "tags": ["A", "B"],
                    "struct": False,
                }
            )
        self.assertEqual(resp.get_json(), {"values": [None, None]})
        self.assertEqual(fake.calls, [])

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
                {
                    "files_by_reverse_priority": ["/a.jpg"],
                    "tags": ["T"],
                    "struct": True,
                }
            )
        self.assertEqual(resp.get_json(), {"values": ["struct"]})
        self.assertEqual(plain.calls, [])

    def test_struct_is_truthiness_based_not_boolean(self):
        # Any truthy JSON value selects the struct instance.
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
        with patch.object(exif_main, "static_et", fake):
            resp = self.post(
                {
                    "files_by_reverse_priority": ["/a.jpg"],
                    "tags": ["T"],
                    "struct": False,
                }
            )
        self.assertEqual(fake.start_calls, 1)
        self.assertEqual(resp.get_json(), {"values": ["v"]})

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
        # get_json() returns None -> subscripting raises -> 400
        resp = self.post(None, raw="null", content_type="application/json")
        self.assertEqual(resp.status_code, 400)

    def test_get_method_not_allowed(self):
        self.assertEqual(self.client.get("/get-tags").status_code, 405)

    # ------------------------------------------------------------------
    # exiftool failure branch -> swallowed, partial values, still 201
    # ------------------------------------------------------------------
    def test_exiftool_error_is_swallowed_and_partial_values_returned(self):
        fake = FakeExifTool(
            values={("A", "/a.jpg"): "ok"},
            running=True,
            raise_on={("B", "/a.jpg")},
        )
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

        # BUG-ish (pinned as current behavior): the loop aborts on the first
        # failing tag, so the response contains FEWER values than tags and the
        # caller cannot tell which tag failed. Status is still 201.
        self.assertEqual(resp.status_code, 201)
        self.assertEqual(resp.get_json(), {"values": ["ok"]})
        log.assert_called_once_with("An error occurred")

    def test_error_on_first_tag_returns_empty_values(self):
        fake = FakeExifTool(running=True, raise_on={("A", "/a.jpg")})
        with patch.object(exif_main, "static_et", fake), patch.object(exif_main, "log"):
            resp = self.post(
                {
                    "files_by_reverse_priority": ["/a.jpg"],
                    "tags": ["A"],
                    "struct": False,
                }
            )
        self.assertEqual(resp.status_code, 201)
        self.assertEqual(resp.get_json(), {"values": []})

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
