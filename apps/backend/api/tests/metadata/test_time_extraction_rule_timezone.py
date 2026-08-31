"""Characterization tests for TimeExtractionRule._get_tz.

These pin the CURRENT behavior of the timezone-description resolver in
api/date_time_extractor.py before it is refactored. They are deliberately
exhaustive about the branch structure (gps / user_default / server_local /
utc / name: / unknown) and about the exception types that escape, because
callers (_transform_tz) rely on the (success, tz) tuple protocol and on
ValueError/UnknownTimeZoneError propagating out.

timezonefinder is imported lazily inside _get_tz; every test that reaches
that branch patches timezonefinder.TimezoneFinder so no geo data is loaded.
"""

from unittest.mock import MagicMock, patch

import pytz
from django.test import TestCase

from api.date_time_extractor import RuleTypes, TimeExtractionRule, _check_gps_ok


def make_rule(**extra):
    params = {"rule_type": RuleTypes.EXIF}
    params.update(extra)
    return TimeExtractionRule(params)


class GetTzGpsBranchTest(TestCase):
    """description == 'gps_timezonefinder'."""

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
        self.assertEqual(result.tzinfo, pytz.utc)

    def test_named_source_and_report_tz_shift(self):
        import datetime

        rule = make_rule(
            transform_tz=1, source_tz="utc", report_tz="name:Europe/Moscow"
        )
        dt = datetime.datetime(2020, 1, 1, 12, 0, 0)
        result = rule._transform_tz(dt, None, None, "UTC")
        # Moscow is UTC+3; the tz is then stamped as utc by _transform_tz.
        self.assertEqual(
            result, datetime.datetime(2020, 1, 1, 15, 0, 0, tzinfo=pytz.utc)
        )
