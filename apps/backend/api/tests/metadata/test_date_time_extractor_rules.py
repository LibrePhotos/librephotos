import datetime
import json
from unittest.mock import patch

import pytz
from django.test import TestCase
from django.utils.dateparse import parse_datetime
from rest_framework.test import APIClient

from api.metadata.datetime_rules import (
    DEFAULT_RULES_JSON,
    DEFAULT_RULES_PARAMS,
    PREDEFINED_RULES_PARAMS,
    RuleContext,
    TimeExtractionRule,
    _extract_no_tz_datetime_from_str,
    as_rules,
    extract_local_date_time,
)
from api.metadata.photo_datetime import extract_date_time
from api.metadata.tags import Tags
from api.models import Photo
from api.tests.utils import create_test_photo, create_test_user

# "Timestamp set by user" as lists saved before #2254 hold it.
RULE_14 = {"id": 14, "name": "Timestamp set by user", "rule_type": "user_defined"}


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
            context=RuleContext(
                gps_lat=None,
                gps_lon=None,
                user_default_tz="UTC",
            ),
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
            context=RuleContext(
                gps_lat=None,
                gps_lon=None,
                user_default_tz="UTC",
            ),
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

    def test_the_old_timestamp_set_by_user_rule_matches_nothing(self):
        # A list saved by an older client may still hold rule 14; a date set
        # by hand no longer goes through the rules (ManualDateOverrideTest).
        result = extract_local_date_time(
            path="/photos/IMG_0001.jpg",
            rules=as_rules([RULE_14, *DEFAULT_RULES_PARAMS]),
            exif_getter=lambda tags: [None] * len(tags),
            context=RuleContext(gps_lat=None, gps_lon=None, user_default_tz="UTC"),
        )
        self.assertIsNone(result)

    def test_the_defaults_have_no_timestamp_set_by_user_rule(self):
        self.assertNotIn(14, [rule["id"] for rule in DEFAULT_RULES_PARAMS])
        self.assertNotIn(14, [rule["id"] for rule in PREDEFINED_RULES_PARAMS])


class BrokenCustomRegexpRuleTest(TestCase):
    """A user's path rule whose custom_regexp does not yield year, month, day
    (and up to four time parts) is a rule that does not match: it must log,
    return None and let the next rule run, not raise out of the scan.
    """

    EXIF_DATE = "2005:01:02 03:04:05"

    def _extract_with(self, custom_regexp):
        rules = as_rules(
            [
                {
                    "rule_type": "path",
                    "path_part": "full_path",
                    "custom_regexp": custom_regexp,
                },
                {"rule_type": "exif", "exif_tag": Tags.DATE_TIME_ORIGINAL},
            ]
        )

        def exif_getter(tags):
            return [
                self.EXIF_DATE if tag == Tags.DATE_TIME_ORIGINAL else None
                for tag in tags
            ]

        return extract_local_date_time(
            path="/photos/2020/01/02/03/04/05/06/07/IMG_abc.jpg",
            rules=rules,
            exif_getter=exif_getter,
            context=RuleContext(
                gps_lat=None,
                gps_lon=None,
                user_default_tz="UTC",
            ),
        )

    def _assert_falls_through(self, custom_regexp):
        with self.assertLogs("api.metadata.datetime_rules", "WARNING"):
            result = self._extract_with(custom_regexp)
        self.assertEqual(
            datetime.datetime(2005, 1, 2, 3, 4, 5, tzinfo=pytz.utc), result
        )

    def test_more_than_seven_groups(self):
        self._assert_falls_through(
            r"(\d{4})/(\d\d)/(\d\d)/(\d\d)/(\d\d)/(\d\d)/(\d\d)/(\d\d)"
        )

    def test_fewer_than_three_groups(self):
        self._assert_falls_through(r"(\d{4})/(\d\d)/")

    def test_unmatched_optional_date_group(self):
        self._assert_falls_through(r"(\d{4})/(\d\d)/(x\d)?")

    def test_non_numeric_group(self):
        self._assert_falls_through(r"(\d{4})/(\d\d)/(\d\d)/.*IMG_(\w+)")

    def test_unmatched_optional_time_group_defaults_to_zero(self):
        result = self._extract_with(r"(\d{4})/(\d\d)/(\d\d)/(x\d)?")
        self.assertEqual(datetime.datetime(2020, 1, 2, tzinfo=pytz.utc), result)


CAMERA_DATE = datetime.datetime(2005, 1, 2, 3, 4, 5, tzinfo=pytz.utc)
MANUAL_DATE = datetime.datetime(2019, 8, 15, 7, 45, 0, tzinfo=pytz.utc)


def _camera_metadata(path, tags, **kwargs):
    """A file whose only date is the camera's EXIF:DateTimeOriginal."""
    return [
        "2005:01:02 03:04:05" if tag == Tags.DATE_TIME_ORIGINAL else None
        for tag in tags
    ]


class ManualDateOverrideTest(TestCase):
    """#2254: a date set by hand is the photo's date, whatever the rule list says.

    It used to apply only through the "Timestamp set by user" rule (id 14), an
    ordinary entry of the list: deleted, or dragged below an EXIF rule, the
    lightbox edit answered 200 and changed nothing, and a rescan replaced the
    dates set earlier with the file's.
    """

    def setUp(self):
        self.client = APIClient()

    def _user_with_rules(self, rules):
        user = create_test_user()
        user.datetime_rules = json.dumps(rules)
        user.save(update_fields=["datetime_rules"])
        self.client.force_authenticate(user=user)
        return user

    def _without_rule_14(self):
        return [rule for rule in json.loads(DEFAULT_RULES_JSON) if rule["id"] != 14]

    def _rule_14_last(self):
        # As a list saved before #2254 has it.
        return [*self._without_rule_14(), RULE_14]

    def _edit(self, photo, value):
        with patch(
            "api.metadata.photo_datetime.get_metadata", side_effect=_camera_metadata
        ):
            return self.client.patch(
                f"/api/photos/edit/{photo.image_hash}/",
                {"exif_timestamp": value},
                format="json",
            )

    def _rescan(self, photo):
        # What a rescan does with the date: the rules over a fresh row.
        fresh = Photo.objects.get(pk=photo.pk)
        with patch(
            "api.metadata.photo_datetime.get_metadata", side_effect=_camera_metadata
        ):
            extract_date_time(fresh)
        return Photo.objects.get(pk=photo.pk).exif_timestamp

    def test_an_edit_applies_without_rule_14(self):
        user = self._user_with_rules(self._without_rule_14())
        photo = create_test_photo(owner=user, exif_timestamp=CAMERA_DATE)

        response = self._edit(photo, MANUAL_DATE.isoformat())

        self.assertEqual(response.status_code, 200)
        self.assertEqual(Photo.objects.get(pk=photo.pk).exif_timestamp, MANUAL_DATE)

    def test_an_edit_applies_with_rule_14_below_the_exif_rules(self):
        user = self._user_with_rules(self._rule_14_last())
        photo = create_test_photo(owner=user, exif_timestamp=CAMERA_DATE)

        self._edit(photo, MANUAL_DATE.isoformat())

        self.assertEqual(Photo.objects.get(pk=photo.pk).exif_timestamp, MANUAL_DATE)

    def test_a_manual_date_survives_a_rescan_without_rule_14(self):
        user = self._user_with_rules(self._without_rule_14())
        photo = create_test_photo(
            owner=user, timestamp=MANUAL_DATE, exif_timestamp=MANUAL_DATE
        )

        self.assertEqual(self._rescan(photo), MANUAL_DATE)

    def test_a_manual_date_survives_a_rescan_with_the_default_rules(self):
        user = self._user_with_rules(json.loads(DEFAULT_RULES_JSON))
        photo = create_test_photo(
            owner=user, timestamp=MANUAL_DATE, exif_timestamp=MANUAL_DATE
        )

        self.assertEqual(self._rescan(photo), MANUAL_DATE)

    def test_clearing_the_manual_date_returns_to_the_files_date(self):
        user = self._user_with_rules(json.loads(DEFAULT_RULES_JSON))
        photo = create_test_photo(owner=user, exif_timestamp=CAMERA_DATE)
        self._edit(photo, MANUAL_DATE.isoformat())

        response = self._edit(photo, None)

        self.assertEqual(response.status_code, 200)
        photo.refresh_from_db()
        self.assertIsNone(photo.timestamp)
        self.assertEqual(photo.exif_timestamp, CAMERA_DATE)
        self.assertEqual(parse_datetime(response.json()["exif_timestamp"]), CAMERA_DATE)
