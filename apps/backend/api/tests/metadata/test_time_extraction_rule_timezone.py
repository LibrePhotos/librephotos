"""Characterization tests for TimeExtractionRule._get_tz.

These pin the CURRENT behavior of the timezone-description resolver in
api/metadata/datetime_rules.py before it is refactored. They are deliberately
exhaustive about the branch structure (gps / user_default / server_local /
utc / name: / unknown) and about the exception types that escape, because
callers (_transform_tz) rely on the (success, tz) tuple protocol and on
ValueError/UnknownTimeZoneError propagating out.

timezonefinder is imported lazily, on the first GPS lookup, and the process
keeps one TimezoneFinder (ProcessTimezoneFinder). Every test that reaches that
branch gets a fresh holder and patches timezonefinder.TimezoneFinder, so no geo
data is loaded and an instance cached by another test is never used.
"""

import os
import subprocess
import sys
import threading
import time
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytz
from django.conf import settings
from django.test import SimpleTestCase, TestCase

from api.metadata import datetime_rules
from api.metadata.datetime_rules import (
    ProcessTimezoneFinder,
    RuleTypes,
    TimeExtractionRule,
    _check_gps_ok,
    _get_gps_tz,
)


def make_rule(**extra):
    params = {"rule_type": RuleTypes.EXIF}
    params.update(extra)
    return TimeExtractionRule(params)


def use_fresh_timezone_finder(test: SimpleTestCase) -> None:
    """Give ``test`` a process finder that has not made its TimezoneFinder yet."""
    patcher = patch.object(datetime_rules, "_timezones", ProcessTimezoneFinder())
    patcher.start()
    test.addCleanup(patcher.stop)


class GetTzGpsBranchTest(TestCase):
    """description == 'gps_timezonefinder'."""

    def setUp(self):
        use_fresh_timezone_finder(self)

    def _patched_finder(self, tz_name):
        finder_instance = MagicMock()
        finder_instance.timezone_at.return_value = tz_name
        finder_cls = MagicMock(return_value=finder_instance)
        return finder_cls, finder_instance

    def test_gps_resolves_to_timezone(self):
        rule = make_rule()
        finder_cls, finder_instance = self._patched_finder("Europe/Moscow")
        with patch("timezonefinder.TimezoneFinder", finder_cls):
            ok, tz = rule._get_tz("gps_timezonefinder", 55.75, 37.61, "UTC")
        self.assertTrue(ok)
        self.assertEqual(tz, pytz.timezone("Europe/Moscow"))
        # lat/lon are passed as keyword args in this exact mapping.
        finder_instance.timezone_at.assert_called_once_with(lng=37.61, lat=55.75)

    def test_gps_finder_returns_none_is_failure(self):
        """Ocean coordinates: timezone_at() -> None -> (False, None), not an error."""
        rule = make_rule()
        finder_cls, _ = self._patched_finder(None)
        with patch("timezonefinder.TimezoneFinder", finder_cls):
            ok, tz = rule._get_tz("gps_timezonefinder", 10.0, -30.0, "UTC")
        self.assertEqual((ok, tz), (False, None))

    def test_gps_finder_returns_empty_string_is_failure(self):
        """Falsy tz name is treated the same as None (no pytz lookup attempted)."""
        rule = make_rule()
        finder_cls, _ = self._patched_finder("")
        with patch("timezonefinder.TimezoneFinder", finder_cls):
            ok, tz = rule._get_tz("gps_timezonefinder", 10.0, -30.0, "UTC")
        self.assertEqual((ok, tz), (False, None))

    def test_gps_missing_coords_short_circuits_without_importing_finder(self):
        """None coordinates fail _check_gps_ok; TimezoneFinder is never constructed."""
        rule = make_rule()
        finder_cls, _ = self._patched_finder("Europe/Moscow")
        with patch("timezonefinder.TimezoneFinder", finder_cls):
            for lat, lon in [(None, None), (None, 37.61), (55.75, None)]:
                with self.subTest(lat=lat, lon=lon):
                    self.assertEqual(
                        rule._get_tz("gps_timezonefinder", lat, lon, "UTC"),
                        (False, None),
                    )
        finder_cls.assert_not_called()

    def test_gps_zero_zero_is_rejected(self):
        """(0, 0) is treated as 'no GPS' by _check_gps_ok."""
        rule = make_rule()
        finder_cls, _ = self._patched_finder("Etc/GMT")
        with patch("timezonefinder.TimezoneFinder", finder_cls):
            self.assertEqual(
                rule._get_tz("gps_timezonefinder", 0.0, 0.0, "UTC"), (False, None)
            )
        finder_cls.assert_not_called()

    def test_gps_nan_and_inf_are_rejected(self):
        rule = make_rule()
        finder_cls, _ = self._patched_finder("Europe/Moscow")
        with patch("timezonefinder.TimezoneFinder", finder_cls):
            for lat, lon in [
                (float("nan"), 1.0),
                (1.0, float("nan")),
                (float("inf"), 1.0),
                (1.0, float("-inf")),
            ]:
                with self.subTest(lat=lat, lon=lon):
                    self.assertEqual(
                        rule._get_tz("gps_timezonefinder", lat, lon, "UTC"),
                        (False, None),
                    )
        finder_cls.assert_not_called()

    def test_gps_partial_zero_is_accepted(self):
        """Only lat == lon == 0 is rejected; a single zero coordinate is valid."""
        rule = make_rule()
        finder_cls, _ = self._patched_finder("Africa/Accra")
        with patch("timezonefinder.TimezoneFinder", finder_cls):
            ok, tz = rule._get_tz("gps_timezonefinder", 0.0, 5.0, "UTC")
        self.assertTrue(ok)
        self.assertEqual(tz, pytz.timezone("Africa/Accra"))

    def test_gps_unknown_zone_name_raises(self):
        """A tz name pytz does not know propagates UnknownTimeZoneError."""
        rule = make_rule()
        finder_cls, _ = self._patched_finder("Mars/Olympus_Mons")
        with patch("timezonefinder.TimezoneFinder", finder_cls):
            with self.assertRaises(pytz.exceptions.UnknownTimeZoneError):
                rule._get_tz("gps_timezonefinder", 55.75, 37.61, "UTC")

    def test_check_gps_ok_helper_matches_branch(self):
        self.assertTrue(_check_gps_ok(55.75, 37.61))
        self.assertFalse(_check_gps_ok(0.0, 0.0))
        self.assertFalse(_check_gps_ok(None, 1.0))


class GetTzStaticBranchesTest(TestCase):
    def test_user_default(self):
        rule = make_rule()
        ok, tz = rule._get_tz("user_default", None, None, "Europe/Berlin")
        self.assertTrue(ok)
        self.assertEqual(tz, pytz.timezone("Europe/Berlin"))

    def test_user_default_ignores_gps(self):
        rule = make_rule()
        ok, tz = rule._get_tz("user_default", 55.75, 37.61, "US/Pacific")
        self.assertTrue(ok)
        self.assertEqual(tz, pytz.timezone("US/Pacific"))

    def test_user_default_none_raises(self):
        """No guard: a missing user default tz blows up rather than returning (False, None)."""
        rule = make_rule()
        with self.assertRaises(pytz.exceptions.UnknownTimeZoneError):
            rule._get_tz("user_default", None, None, None)

    def test_user_default_invalid_raises(self):
        rule = make_rule()
        with self.assertRaises(pytz.exceptions.UnknownTimeZoneError):
            rule._get_tz("user_default", None, None, "Not/AZone")

    def test_server_local_returns_success_with_none_tz(self):
        """None is a *valid* timezone here: it means server local time."""
        rule = make_rule()
        self.assertEqual(rule._get_tz("server_local", None, None, "UTC"), (True, None))

    def test_utc_is_case_insensitive(self):
        rule = make_rule()
        for desc in ["utc", "UTC", "Utc", "uTc"]:
            with self.subTest(desc=desc):
                ok, tz = rule._get_tz(desc, None, None, "Europe/Berlin")
                self.assertTrue(ok)
                self.assertIs(tz, pytz.utc)

    def test_named_timezone(self):
        rule = make_rule()
        ok, tz = rule._get_tz("name:Europe/Moscow", None, None, "UTC")
        self.assertTrue(ok)
        self.assertEqual(tz, pytz.timezone("Europe/Moscow"))

    def test_named_timezone_utc(self):
        rule = make_rule()
        ok, tz = rule._get_tz("name:UTC", None, None, "UTC")
        self.assertTrue(ok)
        self.assertIs(tz, pytz.utc)

    def test_named_timezone_unknown_raises(self):
        rule = make_rule()
        with self.assertRaises(pytz.exceptions.UnknownTimeZoneError):
            rule._get_tz("name:Bogus/Zone", None, None, "UTC")

    def test_named_timezone_empty_name_raises(self):
        rule = make_rule()
        with self.assertRaises(pytz.exceptions.UnknownTimeZoneError):
            rule._get_tz("name:", None, None, "UTC")

    def test_name_prefix_is_case_sensitive(self):
        """Only a lowercase 'name:' prefix is recognized; 'Name:' is unknown."""
        rule = make_rule()
        with self.assertRaises(ValueError):
            rule._get_tz("Name:UTC", None, None, "UTC")


class GetTzErrorBranchTest(TestCase):
    def test_unknown_description_raises_value_error(self):
        rule = make_rule()
        with self.assertRaises(ValueError) as ctx:
            rule._get_tz("nonsense", None, None, "UTC")
        self.assertIn("Unknown tz description nonsense", str(ctx.exception))

    def test_keyword_descriptions_are_case_sensitive(self):
        """Everything except 'utc' must match exactly; upper case is rejected."""
        rule = make_rule()
        for desc in ["GPS_TIMEZONEFINDER", "User_Default", "SERVER_LOCAL"]:
            with self.subTest(desc=desc):
                with self.assertRaises(ValueError):
                    rule._get_tz(desc, None, None, "UTC")

    def test_empty_description_raises_value_error(self):
        rule = make_rule()
        with self.assertRaises(ValueError):
            rule._get_tz("", None, None, "UTC")

    def test_none_description_raises_attribute_error(self):
        """Current (buggy-ish) behavior: None reaches description.lower()."""
        rule = make_rule()
        with self.assertRaises(AttributeError):
            rule._get_tz(None, None, None, "UTC")


class TransformTzIntegrationTest(TestCase):
    """_get_tz is only consumed by _transform_tz; pin that contract too."""

    def test_failed_source_tz_makes_transform_return_none(self):
        rule = make_rule(
            transform_tz=1,
            source_tz="gps_timezonefinder",
            report_tz="utc",
        )
        import datetime

        dt = datetime.datetime(2020, 1, 1, 12, 0, 0)
        # No GPS -> source tz lookup fails -> whole transform yields None.
        self.assertIsNone(rule._transform_tz(dt, None, None, "UTC"))

    def test_failed_report_tz_makes_transform_return_none(self):
        rule = make_rule(
            transform_tz=1,
            source_tz="utc",
            report_tz="gps_timezonefinder",
        )
        import datetime

        dt = datetime.datetime(2020, 1, 1, 12, 0, 0)
        self.assertIsNone(rule._transform_tz(dt, None, None, "UTC"))

    def test_server_local_report_tz_is_used_not_treated_as_failure(self):
        """(True, None) must NOT be confused with failure."""
        import datetime

        rule = make_rule(transform_tz=1, source_tz="utc", report_tz="server_local")
        dt = datetime.datetime(2020, 1, 1, 12, 0, 0)
        result = rule._transform_tz(dt, None, None, "UTC")
        self.assertIsNotNone(result)
        self.assertEqual(result.local_time.tzinfo, pytz.utc)

    def test_named_source_and_report_tz_shift(self):
        import datetime

        rule = make_rule(
            transform_tz=1, source_tz="utc", report_tz="name:Europe/Moscow"
        )
        dt = datetime.datetime(2020, 1, 1, 12, 0, 0)
        result = rule._transform_tz(dt, None, None, "UTC")
        # Moscow is UTC+3; the tz is then stamped as utc by _transform_tz.
        self.assertEqual(
            result.local_time,
            datetime.datetime(2020, 1, 1, 15, 0, 0, tzinfo=pytz.utc),
        )
        # ... and the offset Moscow has then is kept (#2768).
        self.assertEqual(180, result.utc_offset)


class ProcessTimezoneFinderTest(SimpleTestCase):
    """Building a TimezoneFinder takes about a second; a process builds one."""

    def setUp(self):
        use_fresh_timezone_finder(self)
        self.finder = MagicMock()
        self.finder.timezone_at.return_value = "Europe/Berlin"
        self.finder_cls = MagicMock(return_value=self.finder)
        patcher = patch("timezonefinder.TimezoneFinder", self.finder_cls)
        patcher.start()
        self.addCleanup(patcher.stop)

    def test_every_lookup_shares_one_finder(self):
        for lat, lon in [(52.52, 13.40), (48.14, 11.58), (53.55, 9.99)]:
            self.assertEqual(
                _get_gps_tz(lat, lon), (True, pytz.timezone("Europe/Berlin"))
            )

        self.finder_cls.assert_called_once_with()
        self.assertEqual(self.finder.timezone_at.call_count, 3)

    def test_threads_share_one_finder(self):
        def slow_build():
            # Long enough for every thread to arrive while the first one builds.
            time.sleep(0.05)
            return self.finder

        self.finder_cls.side_effect = slow_build
        results = []
        start = threading.Barrier(8)

        def look_up():
            start.wait()
            results.append(_get_gps_tz(52.52, 13.40))

        threads = [threading.Thread(target=look_up) for _ in range(8)]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join()

        self.finder_cls.assert_called_once_with()
        self.assertEqual(results, [(True, pytz.timezone("Europe/Berlin"))] * 8)

    def test_no_finder_without_a_gps_position(self):
        self.assertEqual(_get_gps_tz(None, None), (False, None))
        self.assertEqual(_get_gps_tz(0.0, 0.0), (False, None))

        self.finder_cls.assert_not_called()


PROBE = """
import sys

import django

django.setup()

import api.directory_watcher.file_handlers
import api.metadata.datetime_rules
import librephotos.urls

print("timezonefinder" in sys.modules)
"""


class TimezoneFinderImportTest(SimpleTestCase):
    def test_starting_the_app_does_not_import_timezonefinder(self):
        # Only the first GPS lookup pays for the import and the index.
        backend = Path(settings.BASE_DIR).parent
        environ = dict(os.environ)
        environ.update({"PYTHONPATH": str(backend), "SECRET_KEY": "test-secret-key"})
        result = subprocess.run(
            [sys.executable, "-c", PROBE],
            capture_output=True,
            text=True,
            check=True,
            cwd=str(backend),
            env=environ,
        )

        self.assertEqual(result.stdout.strip().splitlines()[-1], "False")
