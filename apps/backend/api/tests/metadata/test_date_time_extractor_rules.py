import datetime

import pytz
from django.test import TestCase

from api.date_time_extractor import (
    DEFAULT_RULES_PARAMS,
    TimeExtractionRule,
    _extract_no_tz_datetime_from_str,
    as_rules,
    extract_local_date_time,
)
from api.metadata.tags import Tags


class NumericTagValueTest(TestCase):
    """exiftool returns some tags (Rating, ISO, image dimensions, ...) as JSON
    numbers rather than strings. Those values flow into the date-time extractor
    via user-defined EXIF rules and condition_exif checks, where they used to
    reach re.search() directly and raise an uncaught TypeError. The extractor
    must coerce them to str instead.
    """

    def test_extract_numeric_non_date_returns_none(self):
        # Would raise TypeError before the fix; a rating of 5 is not a date.
        self.assertIsNone(_extract_no_tz_datetime_from_str(5))
        self.assertIsNone(_extract_no_tz_datetime_from_str(3.5))

    def test_extract_numeric_dateish_still_parses(self):
        # str() coercion keeps a numeric value that does encode a date working.
        self.assertEqual(
            _extract_no_tz_datetime_from_str(20200101120000),
            datetime.datetime(2020, 1, 1, 12, 0, 0),
        )

    def test_extract_string_value_unchanged(self):
        self.assertEqual(
            _extract_no_tz_datetime_from_str("2020:01:01 12:00:00"),
            datetime.datetime(2020, 1, 1, 12, 0, 0),
        )

    def test_condition_exif_numeric_value_matches(self):
        rule = TimeExtractionRule(
            {
                "rule_type": "exif",
                "exif_tag": "EXIF:DateTimeOriginal",
                "condition_exif": "EXIF:Rating//5",
            }
        )
        # tag_value is the int 5; would raise TypeError before the fix.
        self.assertTrue(rule._check_condition_exif({"EXIF:Rating": 5}))

    def test_condition_exif_numeric_value_no_match(self):
        rule = TimeExtractionRule(
            {
                "rule_type": "exif",
                "exif_tag": "EXIF:DateTimeOriginal",
                "condition_exif": "EXIF:Rating//9",
            }
        )
        self.assertFalse(rule._check_condition_exif({"EXIF:Rating": 5}))

    def test_extract_local_date_time_numeric_exif_does_not_crash(self):
        # Full path: an EXIF rule whose tag resolves to a number must not crash
        # the whole extraction; it simply yields no datetime and falls through.
        rules = as_rules([{"rule_type": "exif", "exif_tag": "EXIF:Rating"}])

        def exif_getter(tags):
            return [5 for _ in tags]

        result = extract_local_date_time(
            path="/photos/IMG_0001.jpg",
            rules=rules,
            exif_getter=exif_getter,
            gps_lat=None,
            gps_lon=None,
            user_default_tz="UTC",
            user_defined_timestamp=None,
        )
        self.assertIsNone(result)


class DefaultRulesOrderTest(TestCase):
    """The default rules must be able to read back what LibrePhotos writes.

    A date edit is persisted as ``XMP:DateCreated`` (an EXIF date tag cannot be
    written into a sidecar, and overwriting ``EXIF:DateTimeOriginal`` would
    destroy the capture time). A plain ``EXIF:DateTimeOriginal`` read wins over
    XMP when the two disagree, so the ``XMP:DateCreated`` rule has to be ranked
    above it or the next scan reverts the user's edit.
    """

    @staticmethod
    def _extract(exif_values):
        def exif_getter(tags):
            return [exif_values.get(tag) for tag in tags]

        return extract_local_date_time(
            path="/photos/IMG_0001.jpg",
            rules=as_rules(DEFAULT_RULES_PARAMS),
            exif_getter=exif_getter,
            gps_lat=None,
            gps_lon=None,
            user_default_tz="UTC",
            user_defined_timestamp=None,
        )

    def test_date_created_wins_over_the_exif_date_tags(self):
        result = self._extract(
            {
                Tags.DATE_CREATED: "2019:08:15 07:45:00",
                Tags.DATE_TIME_ORIGINAL: "2005:01:02 03:04:05",
                Tags.DATE_TIME: "2001:02:03 04:05:06",
            }
        )
        self.assertEqual(
            datetime.datetime(2019, 8, 15, 7, 45, 0, tzinfo=pytz.utc), result
        )

    def test_date_time_original_wins_when_there_is_no_date_created(self):
        result = self._extract(
            {
                Tags.DATE_TIME_ORIGINAL: "2005:01:02 03:04:05",
                Tags.DATE_TIME: "2001:02:03 04:05:06",
            }
        )
        self.assertEqual(
            datetime.datetime(2005, 1, 2, 3, 4, 5, tzinfo=pytz.utc), result
        )

    def test_modify_date_is_still_used_as_a_last_resort(self):
        result = self._extract({Tags.DATE_TIME: "2001:02:03 04:05:06"})
        self.assertEqual(
            datetime.datetime(2001, 2, 3, 4, 5, 6, tzinfo=pytz.utc), result
        )

    def test_user_defined_timestamp_still_outranks_every_exif_rule(self):
        user_timestamp = datetime.datetime(1999, 12, 31, 23, 59, 59, tzinfo=pytz.utc)

        def exif_getter(tags):
            return [{Tags.DATE_CREATED: "2019:08:15 07:45:00"}.get(tag) for tag in tags]

        result = extract_local_date_time(
            path="/photos/IMG_0001.jpg",
            rules=as_rules(DEFAULT_RULES_PARAMS),
            exif_getter=exif_getter,
            gps_lat=None,
            gps_lon=None,
            user_default_tz="UTC",
            user_defined_timestamp=user_timestamp,
        )
        self.assertEqual(user_timestamp, result)
