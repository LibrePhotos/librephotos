"""Custom date rules (#2272): the file-name pattern, what a user may save, the
rule check and the "Why this date?" endpoints, and a custom rule in a scan."""

import datetime
import json
import os
import re
import time
import uuid
from unittest.mock import patch

import pytz
from django.test import SimpleTestCase, TestCase
from rest_framework.test import APIClient

from api.metadata.date_patterns import (
    DatePatternError,
    compile_date_pattern,
)
from api.metadata.date_rule_checks import (
    DATE_TAG_NAMES,
    FIRST_CUSTOM_ID,
    changed_rule_problem,
    is_plain_text_pattern,
    rule_problems,
)
from api.metadata.datetime_rules import (
    PREDEFINED_RULES_PARAMS,
    RuleContext,
    TimeExtractionRule,
    evaluate_rules,
)
from api.metadata.photo_datetime import extract_date_time
from api.metadata.reader import MetadataReadError
from api.metadata.tags import Tags
from api.models import Photo, User
from api.tests.utils import (
    ONE_PIXEL_PNG,
    TEST_MEDIA_ROOT,
    create_test_file,
    create_test_photo,
    create_test_user,
)

CONTEXT = RuleContext(gps_lat=None, gps_lon=None, user_default_tz="UTC")

# What the rule form saves for "QuickTime:MediaCreateDate, recorded in UTC,
# convert to the GPS time zone" (the issue's first acceptance criterion).
MEDIA_CREATE_RULE = {
    "id": FIRST_CUSTOM_ID,
    "name": "Video date in UTC, GPS time zone",
    "custom": True,
    "rule_type": "exif",
    "exif_tag": "QuickTime:MediaCreateDate",
    "transform_tz": 1,
    "source_tz": "utc",
    "report_tz": "gps_timezonefinder",
}
NAME_RULE = {
    "id": FIRST_CUSTOM_ID + 1,
    "name": "Copied phone files",
    "custom": True,
    "rule_type": "path",
    "date_pattern": "YYYY-MM-DD HH.mm.ss",
}


def _found(rule, path, tags=None):
    found = TimeExtractionRule(rule).apply(path, tags or {}, CONTEXT)
    return found.local_time.replace(tzinfo=None) if found else None


class DatePatternTest(SimpleTestCase):
    def test_reads_the_date_where_the_pattern_matches(self):
        self.assertEqual(
            datetime.datetime(2023, 1, 1, 12, 0, 5),
            _found(NAME_RULE, "/photos/2023-01-01 12.00.05 (2).jpg"),
        )

    def test_day_first_and_any_character(self):
        rule = {**NAME_RULE, "date_pattern": "DD?MM?YYYY"}
        self.assertEqual(
            datetime.datetime(2021, 3, 9), _found(rule, "/p/scan 09_03.2021.tif")
        )

    def test_full_path(self):
        rule = {**NAME_RULE, "date_pattern": "YYYY/MM/DD", "path_part": "full_path"}
        self.assertEqual(
            datetime.datetime(2019, 7, 4), _found(rule, "/photos/2019/07/04/a.jpg")
        )
        self.assertIsNone(
            _found({**rule, "path_part": "filename"}, "/2019/07/04/a.jpg")
        )

    def test_a_name_without_the_date_does_not_apply(self):
        self.assertIsNone(_found(NAME_RULE, "/photos/IMG_0001.jpg"))

    def test_an_impossible_date_does_not_apply(self):
        self.assertIsNone(_found(NAME_RULE, "/photos/2023-13-01 12.00.00.jpg"))

    def test_patterns_that_cannot_be_used(self):
        for pattern, message in (
            ("", "1 to 64"),
            ("Y" * 65, "1 to 64"),
            ("MM-DD HH", "year"),
            ("YYYY-MM", "day"),
            ("YYYY-MM-DD-DD", "day twice"),
        ):
            with self.subTest(pattern=pattern):
                with self.assertRaisesRegex(DatePatternError, message):
                    compile_date_pattern(pattern)

    def test_special_characters_stand_for_themselves(self):
        compiled = compile_date_pattern("(YYYY)[MM]+DD.*")
        self.assertIsNotNone(compiled.regexp.search("x(2020)[01]+02.*"))
        self.assertIsNone(compiled.regexp.search("x2020010203"))

    def test_a_long_name_is_searched_in_linear_time(self):
        # A user's regular expression could backtrack exponentially here.
        compiled = compile_date_pattern("?" * 30 + "YYYYMMDD")
        started = time.monotonic()
        self.assertIsNone(compiled.regexp.search("a" * 5000))
        self.assertLess(time.monotonic() - started, 1)


class PlainTextPatternTest(SimpleTestCase):
    def test_escaped_text_is_plain(self):
        for text in ("Moscow_Visit", "a.b (1)", "C:\\Users", "50% [x]", "é"):
            with self.subTest(text=text):
                self.assertTrue(is_plain_text_pattern(re.escape(text)))

    def test_expressions_are_not(self):
        for pattern in ("a+", "(a|b)", ".*", "\\d", "\\1", "a\\", "x{2}", "^a$"):
            with self.subTest(pattern=pattern):
                self.assertFalse(is_plain_text_pattern(pattern))


class RuleProblemsTest(SimpleTestCase):
    def test_every_predefined_rule_can_be_saved(self):
        for rule in PREDEFINED_RULES_PARAMS:
            with self.subTest(rule=rule["id"]):
                self.assertEqual({}, rule_problems(rule))

    def test_the_rules_the_form_makes_can_be_saved(self):
        self.assertEqual({}, rule_problems(MEDIA_CREATE_RULE))
        self.assertEqual({}, rule_problems(NAME_RULE))
        self.assertEqual(
            {},
            rule_problems(
                {
                    **NAME_RULE,
                    "path_part": "full_path",
                    "transform_tz": 1,
                    "source_tz": "utc",
                    "report_tz": "name:Europe/Berlin",
                    "condition_path": re.escape("Moscow_Visit"),
                    "condition_filename": re.escape("IMG (1)"),
                    "condition_exif": "EXIF:Model//" + re.escape("iPhone 15"),
                }
            ),
        )

    def test_each_param_that_cannot_be_saved_is_named(self):
        cases = (
            ({"rule_type": "exif", "exif_tag": "EXIF:DateTime"}, "exif_tag"),
            ({"rule_type": "exif", "exif_tag": "EXIF:Model"}, "exif_tag"),
            ({"rule_type": "made_up"}, "rule_type"),
            ({"rule_type": "path", "custom_regexp": "(a+)+$"}, "custom_regexp"),
            ({"rule_type": "path", "date_pattern": "MM-DD"}, "date_pattern"),
            ({"rule_type": "path", "path_part": "parent"}, "path_part"),
            ({"rule_type": "path", "predefined_regexp": "nope"}, "predefined_regexp"),
            ({"rule_type": "filesystem", "file_property": "atime"}, "file_property"),
            ({**NAME_RULE, "id": 5}, "id"),
            ({**NAME_RULE, "id": "1000"}, "id"),
            ({**NAME_RULE, "name": "x" * 201}, "name"),
            ({**NAME_RULE, "transform_tz": 1, "source_tz": "utc"}, "report_tz"),
            ({**NAME_RULE, "report_tz": "name:Mars/Olympus"}, "report_tz"),
            ({**NAME_RULE, "source_tz": "local"}, "source_tz"),
            ({**NAME_RULE, "condition_path": "(a+)+$"}, "condition_path"),
            ({**NAME_RULE, "condition_filename": 7}, "condition_filename"),
            ({**NAME_RULE, "condition_exif": "EXIF:Model"}, "condition_exif"),
            ({**NAME_RULE, "condition_exif": "File:FileName//x"}, "condition_exif"),
            ({**NAME_RULE, "condition_exif": "EXIF:Model//a.*"}, "condition_exif"),
        )
        for rule, field in cases:
            with self.subTest(rule=rule):
                self.assertIn(field, rule_problems(rule))

    def test_a_rule_is_an_object(self):
        self.assertEqual(["rule"], list(rule_problems("rule")))


class ChangedRuleProblemTest(SimpleTestCase):
    LEGACY = {"id": 30, "name": "Old", "rule_type": "path", "custom_regexp": "(\\d+)"}

    def test_a_rule_saved_before_is_not_checked_again(self):
        saved = json.dumps([self.LEGACY])
        self.assertIsNone(changed_rule_problem([NAME_RULE, self.LEGACY], saved))

    def test_a_new_rule_is(self):
        problem = changed_rule_problem([self.LEGACY], [])
        self.assertEqual(
            "Rule 'Old': custom_regexp: Write where the date is as a date_pattern.",
            problem,
        )

    def test_a_rule_without_a_name_is_named_by_its_place(self):
        problem = changed_rule_problem([NAME_RULE, {"rule_type": "x"}], None)
        self.assertTrue(problem.startswith("Rule number 2: rule_type:"), problem)

    def test_a_value_that_is_no_list_has_no_rules(self):
        self.assertIsNone(changed_rule_problem("not json", None))
        self.assertIsNone(changed_rule_problem({"rule_type": "x"}, None))


class EvaluateRulesTest(SimpleTestCase):
    def test_every_rule_reports_what_it_reads(self):
        broken = {"id": 40, "rule_type": "exif", "exif_tag": Tags.DATE_TIME_ORIGINAL}
        broken.update(transform_tz=1, source_tz="utc", report_tz="name:Mars/Olympus")
        rules = [
            TimeExtractionRule(MEDIA_CREATE_RULE),
            TimeExtractionRule(NAME_RULE),
            TimeExtractionRule(broken),
        ]
        values = {Tags.DATE_TIME_ORIGINAL: "2020:01:01 10:00:00"}

        outcomes = evaluate_rules(
            "/p/2023-01-01 12.00.05.jpg",
            rules,
            lambda tags: [values.get(tag) for tag in tags],
            CONTEXT,
        )

        self.assertEqual(
            [None, NAME_RULE["id"], None],
            [o.found and o.found.rule_id for o in outcomes],
        )
        self.assertEqual([None, None], [outcomes[0].error, outcomes[1].error])
        self.assertIn("Mars/Olympus", outcomes[2].error)


class CustomRuleScanTest(TestCase):
    """A saved custom rule is what the next scan reads the date with."""

    def test_a_custom_file_name_rule_dates_the_photo(self):
        user = create_test_user(datetime_rules=json.dumps([NAME_RULE]))
        main_file = create_test_file(
            os.path.join(TEST_MEDIA_ROOT, "2023-01-01 12.00.05 (2).png"),
            user,
            ONE_PIXEL_PNG + b"custom-rule",
        )
        photo = create_test_photo(owner=user, main_file=main_file)

        with patch(
            "api.metadata.photo_datetime.get_metadata",
            side_effect=lambda path, tags, **kwargs: [None for _ in tags],
        ):
            extract_date_time(photo)

        photo = Photo.objects.get(pk=photo.pk)
        self.assertEqual(
            datetime.datetime(2023, 1, 1, 12, 0, 5, tzinfo=pytz.utc),
            photo.exif_timestamp,
        )
        self.assertEqual(NAME_RULE["id"], photo.exif_timestamp_source)


class SaveCustomRulesTest(TestCase):
    def setUp(self):
        self.user = create_test_user()
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)

    def _save(self, rules):
        return self.client.patch(
            f"/api/user/{self.user.id}/",
            {"datetime_rules": json.dumps(rules)},
            format="json",
        )

    def test_custom_rules_are_saved(self):
        response = self._save([MEDIA_CREATE_RULE, NAME_RULE])
        self.assertEqual(200, response.status_code, response.content)
        saved = json.loads(User.objects.get(pk=self.user.pk).datetime_rules)
        self.assertEqual([MEDIA_CREATE_RULE, NAME_RULE], saved)

    def test_a_rule_on_an_unknown_tag_is_refused(self):
        response = self._save([{**MEDIA_CREATE_RULE, "exif_tag": "EXIF:DateTime"}])
        self.assertEqual(400, response.status_code)
        error = response.json()["errors"][0]
        self.assertEqual("datetime_rules", error["field"])
        self.assertEqual("invalid_date_rule", error["code"])
        self.assertIn("exif_tag", error["message"])

    def test_a_rule_saved_through_the_api_before_still_saves(self):
        legacy = {"id": 30, "name": "Old", "rule_type": "path", "custom_regexp": "x"}
        User.objects.filter(pk=self.user.pk).update(datetime_rules=json.dumps([legacy]))
        response = self._save([legacy, NAME_RULE])
        self.assertEqual(200, response.status_code, response.content)


class DateRuleEndpointsTest(TestCase):
    def setUp(self):
        self.user = create_test_user()
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)

    def test_options_name_the_tags_a_rule_may_use(self):
        body = self.client.get("/api/datetime-rules/options/").json()
        names = {tag["name"] for tag in body["date_tags"]}
        self.assertEqual(DATE_TAG_NAMES, names)
        self.assertIn(
            {"name": "QuickTime:MediaCreateDate", "utc": True}, body["date_tags"]
        )
        self.assertIn("EXIF:Model", body["condition_tags"])
        self.assertEqual(FIRST_CUSTOM_ID, body["first_custom_id"])

    def test_check_answers_a_rule_that_can_be_saved(self):
        response = self.client.post(
            "/api/datetime-rules/check/", {"rule": NAME_RULE}, format="json"
        )
        self.assertEqual(200, response.status_code, response.content)
        self.assertEqual({"rule": NAME_RULE}, response.json())

    def test_check_names_each_param_that_cannot_be_saved(self):
        rule = {**NAME_RULE, "date_pattern": "MM", "condition_path": ".*"}
        response = self.client.post(
            "/api/datetime-rules/check/", {"rule": rule}, format="json"
        )
        self.assertEqual(400, response.status_code)
        errors = response.json()["errors"]
        self.assertEqual(
            ["date_pattern", "condition_path"], [e["field"] for e in errors]
        )
        self.assertEqual({"invalid_date_rule"}, {e["code"] for e in errors})

    def test_check_needs_a_rule(self):
        response = self.client.post("/api/datetime-rules/check/", {}, format="json")
        self.assertEqual(400, response.status_code)
        self.assertEqual("rule", response.json()["errors"][0]["field"])

    def test_anonymous_callers_are_refused(self):
        client = APIClient()
        self.assertEqual(401, client.get("/api/datetime-rules/options/").status_code)
        response = client.post(
            "/api/datetime-rules/check/", {"rule": {}}, format="json"
        )
        self.assertEqual(401, response.status_code)
        response = client.get(f"/api/datetime-rules/test/?photo_id={uuid.uuid4()}")
        self.assertEqual(401, response.status_code)


def _file_values(values):
    return patch(
        "api.metadata.photo_datetime.get_metadata",
        side_effect=lambda path, tags, **kwargs: [values.get(tag) for tag in tags],
    )


class DateRulesTestEndpointTest(TestCase):
    CAMERA = {Tags.DATE_TIME_ORIGINAL: "2024:05:06 07:08:09"}

    def setUp(self):
        camera_rule = {"id": 1, "name": "Camera", "rule_type": "exif"}
        camera_rule["exif_tag"] = Tags.DATE_TIME_ORIGINAL
        self.rules = [MEDIA_CREATE_RULE, camera_rule, NAME_RULE]
        self.user = create_test_user(datetime_rules=json.dumps(self.rules))
        self.photo = create_test_photo(owner=self.user)
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)

    def _test(self, photo):
        return self.client.get(f"/api/datetime-rules/test/?photo_id={photo.pk}")

    def test_reports_the_winning_rule_and_every_outcome(self):
        before = Photo.objects.filter(pk=self.photo.pk).values().get()

        with _file_values(self.CAMERA):
            response = self._test(self.photo)

        self.assertEqual(200, response.status_code, response.content)
        body = response.json()
        self.assertEqual(str(self.photo.pk), body["photo_id"])
        self.assertEqual(1, body["winner"])
        self.assertFalse(body["date_set_by_user"])
        self.assertEqual(
            ["not_applicable", "applies", "not_applicable"],
            [o["outcome"] for o in body["outcomes"]],
        )
        self.assertEqual(
            [FIRST_CUSTOM_ID, 1, FIRST_CUSTOM_ID + 1],
            [o["rule_id"] for o in body["outcomes"]],
        )
        self.assertEqual("2024-05-06T07:08:09Z", body["outcomes"][1]["local_time"])
        # Nothing is saved.
        self.assertEqual(before, Photo.objects.filter(pk=self.photo.pk).values().get())

    def test_another_users_photo_is_not_found(self):
        other = create_test_photo(owner=create_test_user())
        with _file_values(self.CAMERA) as read:
            response = self._test(other)
        self.assertEqual(404, response.status_code)
        read.assert_not_called()

    def test_no_rule_applies(self):
        with _file_values({}):
            body = self._test(self.photo).json()
        self.assertIsNone(body["winner"])

    def test_a_file_that_is_gone(self):
        os.remove(self.photo.main_file.path)
        response = self._test(self.photo)
        self.assertEqual(404, response.status_code)
        self.assertEqual("file_missing", response.json()["errors"][0]["code"])

    def test_an_unreadable_file(self):
        with patch(
            "api.metadata.photo_datetime.get_metadata",
            side_effect=MetadataReadError("down"),
        ):
            response = self._test(self.photo)
        self.assertEqual(503, response.status_code)

    def test_a_malformed_photo_id(self):
        response = self.client.get("/api/datetime-rules/test/?photo_id=nope")
        self.assertEqual(400, response.status_code)
        self.assertEqual("photo_id", response.json()["errors"][0]["field"])
