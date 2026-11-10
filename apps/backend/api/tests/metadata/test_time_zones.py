"""api.metadata.time_zones: the zone list, name lookups and reading a wall clock in a zone.

The expected values were taken from pytz 2026.6 (``pytz.all_timezones``,
``pytz.timezone``, ``zone.localize``), which this module replaced.
"""

import ast
import datetime
import pathlib
from datetime import UTC
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from django.core.exceptions import ValidationError
from django.test import SimpleTestCase, TestCase
from rest_framework.test import APIClient

from api.metadata.datetime_rules import RuleContext, TimeExtractionRule
from api.metadata.time_zones import ALL_TIME_ZONES, localize, time_zone
from api.models.user import validate_time_zone
from api.tests.utils import create_test_user

MIGRATIONS = pathlib.Path(__file__).resolve().parents[2] / "migrations"


def _choices_up_to_1_7():
    """The ``default_timezone`` choices the squashed migration stored: the
    names a user could save until the field got a validator (0238)."""
    tree = ast.parse((MIGRATIONS / "0001_squashed_0100.py").read_text("utf-8"))
    for node in ast.walk(tree):
        # ("default_timezone", models.TextField(choices=[...], ...)) in CreateModel
        if (
            isinstance(node, ast.Tuple)
            and len(node.elts) == 2
            and isinstance(node.elts[0], ast.Constant)
            and node.elts[0].value == "default_timezone"
            and isinstance(node.elts[1], ast.Call)
        ):
            field = node.elts[1]
            choices = next(k.value for k in field.keywords if k.arg == "choices")
            return [ast.literal_eval(choice)[0] for choice in choices.elts]
    raise AssertionError("default_timezone not found in 0001_squashed_0100")


class ZoneListTest(SimpleTestCase):
    def test_the_list_is_the_one_pytz_gave(self):
        self.assertEqual(len(ALL_TIME_ZONES), 597)
        self.assertEqual(list(ALL_TIME_ZONES), sorted(ALL_TIME_ZONES))
        self.assertNotIn("Factory", ALL_TIME_ZONES)
        for name in ("UTC", "Etc/GMT+5", "Europe/Kyiv", "Europe/Kiev", "US/Pacific"):
            self.assertIn(name, ALL_TIME_ZONES)

    def test_every_name_a_user_could_store_still_validates(self):
        stored = _choices_up_to_1_7()
        self.assertEqual(len(stored), 597)
        for name in stored:
            validate_time_zone(name)
            self.assertIsNotNone(time_zone(name))


class TimeZoneLookupTest(SimpleTestCase):
    def test_names_in_any_case(self):
        self.assertIs(time_zone("Europe/Berlin"), ZoneInfo("Europe/Berlin"))
        self.assertIs(time_zone("europe/berlin"), ZoneInfo("Europe/Berlin"))
        self.assertIs(time_zone("US/PACIFIC"), ZoneInfo("US/Pacific"))
        self.assertIs(time_zone("Etc/GMT_plus_5"), ZoneInfo("Etc/GMT+5"))

    def test_utc_in_any_case_is_utc(self):
        for name in ("UTC", "utc", "Utc"):
            self.assertIs(time_zone(name), UTC)

    def test_unknown_names_raise_a_key_error_naming_them(self):
        for name in (
            "",
            "Bogus/Zone",
            "Factory",
            "posixrules",
            "localtime",
            "../etc/passwd",
            "Europe/Berlin\x00",
            "™",
            None,
            5,
        ):
            with (
                self.subTest(name=name),
                self.assertRaises(ZoneInfoNotFoundError) as caught,
            ):
                time_zone(name)
            self.assertIsInstance(caught.exception, KeyError)
            self.assertEqual(caught.exception.args, (name,))


class LocalizeTest(SimpleTestCase):
    # zone, wall clock, the UTC time pytz's localize() gave
    CASES = [
        ("Europe/Berlin", (2024, 6, 1, 12, 0), (2024, 6, 1, 10, 0)),
        # Clocks forward: 02:30 never happens; read at the winter offset.
        ("Europe/Berlin", (2024, 3, 31, 2, 30), (2024, 3, 31, 1, 30)),
        # Clocks back: 02:30 happens twice; the standard-time one.
        ("Europe/Berlin", (2024, 10, 27, 2, 30), (2024, 10, 27, 1, 30)),
        ("America/New_York", (2024, 3, 10, 2, 30), (2024, 3, 10, 7, 30)),
        ("America/New_York", (2024, 11, 3, 1, 30), (2024, 11, 3, 6, 30)),
        # Half-hour daylight saving time.
        ("Australia/Lord_Howe", (2024, 4, 7, 1, 45), (2024, 4, 6, 15, 15)),
        ("Australia/Lord_Howe", (2024, 10, 6, 2, 15), (2024, 10, 5, 15, 45)),
        # Irish Standard Time is the summer one (negative DST in winter).
        ("Europe/Dublin", (2024, 10, 27, 1, 30), (2024, 10, 27, 0, 30)),
        ("Europe/Dublin", (2024, 3, 31, 1, 30), (2024, 3, 31, 1, 30)),
        ("Pacific/Apia", (2011, 12, 30, 12, 0), (2011, 12, 30, 22, 0)),
        ("Asia/Kolkata", (2024, 1, 1, 0, 0), (2023, 12, 31, 18, 30)),
        # Clocks forward at midnight.
        ("America/Sao_Paulo", (2018, 11, 4, 0, 30), (2018, 11, 4, 3, 30)),
    ]

    def test_like_pytz_localize(self):
        for zone, wall, utc in self.CASES:
            with self.subTest(zone=zone, wall=wall):
                found = localize(datetime.datetime(*wall), time_zone(zone))
                # A time in a gap or fold compares unequal to any other zone's
                # (PEP 495), so compare in UTC.
                self.assertEqual(
                    found.astimezone(UTC), datetime.datetime(*utc, tzinfo=UTC)
                )
                self.assertEqual(found.replace(tzinfo=None), datetime.datetime(*wall))

    def test_fixed_offsets(self):
        wall = datetime.datetime(2024, 6, 1, 12, 0)
        self.assertEqual(localize(wall, UTC), wall.replace(tzinfo=UTC))
        plus_two = datetime.timezone(datetime.timedelta(hours=2))
        self.assertEqual(localize(wall, plus_two), wall.replace(tzinfo=plus_two))


class TransformTzSourceZoneTest(SimpleTestCase):
    """A rule saved through the API with ``transform_tz`` and a ``source_tz``
    other than utc (the settings form always writes utc). Its time was read at
    the zone's first offset in the database (local mean time: +0:53 in
    Berlin) instead of the one for that date."""

    def _rule(self, source_tz, report_tz="utc"):
        return TimeExtractionRule(
            {
                "rule_type": "path",
                "path_part": "filename",
                "transform_tz": 1,
                "source_tz": source_tz,
                "report_tz": report_tz,
            }
        )

    def test_a_named_source_zone_uses_the_offset_of_that_date(self):
        found = self._rule("name:Europe/Berlin").apply(
            "20240601_120000.jpg", {}, _context("UTC")
        )
        self.assertEqual(
            found.local_time, datetime.datetime(2024, 6, 1, 10, 0, tzinfo=UTC)
        )
        self.assertEqual(found.utc_offset, 0)

    def test_the_owner_zone_as_source_and_report(self):
        found = self._rule("user_default", "user_default").apply(
            "20240115_093000.jpg", {}, _context("America/New_York")
        )
        self.assertEqual(
            found.local_time, datetime.datetime(2024, 1, 15, 9, 30, tzinfo=UTC)
        )
        self.assertEqual(found.utc_offset, -300)

    def test_a_time_skipped_by_dst_reads_at_the_winter_offset(self):
        found = self._rule("name:Europe/Berlin").apply(
            "20240331_023000.jpg", {}, _context("UTC")
        )
        self.assertEqual(
            found.local_time, datetime.datetime(2024, 3, 31, 1, 30, tzinfo=UTC)
        )


def _context(user_default_tz):
    return RuleContext(gps_lat=None, gps_lon=None, user_default_tz=user_default_tz)


class DefaultTimezoneFieldTest(TestCase):
    def setUp(self):
        self.user = create_test_user()
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)

    def test_a_known_zone_is_saved(self):
        response = self.client.patch(
            f"/api/user/{self.user.id}/",
            {"default_timezone": "Europe/Berlin"},
            format="json",
        )
        self.assertEqual(response.status_code, 200, response.content)
        self.user.refresh_from_db()
        self.assertEqual(self.user.default_timezone, "Europe/Berlin")

    def test_an_unknown_or_miscased_zone_is_refused(self):
        for name in ("Mars/Olympus_Mons", "europe/berlin", "Factory", ""):
            with self.subTest(name=name):
                response = self.client.patch(
                    f"/api/user/{self.user.id}/",
                    {"default_timezone": name},
                    format="json",
                )
                self.assertEqual(response.status_code, 400)
                fields = [error["field"] for error in response.json()["errors"]]
                self.assertEqual(fields, ["default_timezone"])
        self.user.refresh_from_db()
        self.assertEqual(self.user.default_timezone, "UTC")

    def test_the_model_validator(self):
        validate_time_zone("UTC")
        for value in ("europe/berlin", "Factory", "", None):
            with self.subTest(value=value), self.assertRaises(ValidationError):
                validate_time_zone(value)
