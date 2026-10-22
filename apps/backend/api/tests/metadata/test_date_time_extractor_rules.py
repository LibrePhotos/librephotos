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
    CaptureTime,
    RuleContext,
    TimeExtractionRule,
    _extract_no_tz_datetime_from_str,
    as_rules,
    extract_local_date_time,
)
from api.metadata.edits import set_capture_times, set_to
from api.metadata.photo_datetime import extract_date_time
from api.metadata.tags import Tags
from api.models import Photo
from api.tests.utils import create_test_photo, create_test_user

# "Timestamp set by user" as lists saved before #2254 hold it.
RULE_14 = {"id": 14, "name": "Timestamp set by user", "rule_type": "user_defined"}


def _local_time_of(found):
    """The wall clock of what the rules read, None when no rule applied."""
    return found.local_time if found else None


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

        return _local_time_of(
            extract_local_date_time(
                path="/photos/IMG_0001.jpg",
                rules=as_rules(DEFAULT_RULES_PARAMS),
                exif_getter=exif_getter,
                context=RuleContext(
                    gps_lat=None,
                    gps_lon=None,
                    user_default_tz="UTC",
                ),
            )
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


class DefaultVideoRulesTest(TestCase):
    """Where the default rules date a video from (#2268).

    A phone writes the local capture time with its offset into
    ``QuickTime:CreationDate`` and the UTC time into ``QuickTime:CreateDate``;
    an MKV or WebM states only a UTC ``Matroska:DateTimeOriginal``.
    """

    SAN_FRANCISCO = (37.7749, -122.4194)

    def _extract(self, exif_values, gps=(None, None), path="/videos/clip.mp4"):
        def exif_getter(tags):
            return [exif_values.get(tag) for tag in tags]

        return _local_time_of(
            extract_local_date_time(
                path=path,
                rules=as_rules(DEFAULT_RULES_PARAMS),
                exif_getter=exif_getter,
                context=RuleContext(
                    gps_lat=gps[0],
                    gps_lon=gps[1],
                    user_default_tz="Europe/Berlin",
                ),
            )
        )

    def test_the_default_rule_order(self):
        self.assertEqual(
            [16, 1, 15, 17, 2, 18, 11, 20, 21, 3, 4, 19, 5],
            [rule["id"] for rule in DEFAULT_RULES_PARAMS],
        )

    def test_a_phone_video_keeps_its_local_time_without_a_position(self):
        result = self._extract(
            {
                Tags.QUICKTIME_CREATION_DATE: "2024:04:03 03:00:00-07:00",
                Tags.QUICKTIME_CREATE_DATE: "2024:04:03 10:00:00",
            }
        )
        self.assertEqual(datetime.datetime(2024, 4, 3, 3, 0, tzinfo=pytz.utc), result)

    def test_the_stated_local_time_wins_over_the_gps_time_zone(self):
        # Shot in San Francisco, the position says Berlin (a wrong fix or a
        # position the user set): the phone's own clock is the better source.
        result = self._extract(
            {
                Tags.QUICKTIME_CREATION_DATE: "2024:04:03 03:00:00-07:00",
                Tags.QUICKTIME_CREATE_DATE: "2024:04:03 10:00:00",
            },
            gps=(52.52, 13.405),
        )
        self.assertEqual(datetime.datetime(2024, 4, 3, 3, 0, tzinfo=pytz.utc), result)

    def test_a_video_without_creation_date_still_uses_create_date(self):
        result = self._extract(
            {Tags.QUICKTIME_CREATE_DATE: "2024:04:03 10:00:00"},
            gps=self.SAN_FRANCISCO,
        )
        self.assertEqual(datetime.datetime(2024, 4, 3, 3, 0, tzinfo=pytz.utc), result)

    def test_a_matroska_date_is_converted_with_the_position(self):
        result = self._extract(
            {Tags.MATROSKA_DATE: "2025:03:12 17:00:00Z"},
            gps=self.SAN_FRANCISCO,
            path="/videos/clip.mkv",
        )
        self.assertEqual(datetime.datetime(2025, 3, 12, 10, 0, tzinfo=pytz.utc), result)

    def test_a_matroska_date_falls_back_to_the_default_time_zone(self):
        result = self._extract(
            {Tags.MATROSKA_DATE: "2025:03:12 17:00:00Z"}, path="/videos/clip.webm"
        )
        self.assertEqual(datetime.datetime(2025, 3, 12, 18, 0, tzinfo=pytz.utc), result)

    def test_a_date_in_the_file_name_wins_over_the_default_time_zone(self):
        # Rule 3 (file name, local time) stays above rule 19, as above rule 4.
        result = self._extract(
            {Tags.MATROSKA_DATE: "2025:03:12 17:00:00Z"},
            path="/videos/VID_20250312_170000.mkv",
        )
        self.assertEqual(datetime.datetime(2025, 3, 12, 17, 0, tzinfo=pytz.utc), result)


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

        return _local_time_of(
            extract_local_date_time(
                path="/photos/2020/01/02/03/04/05/06/07/IMG_abc.jpg",
                rules=rules,
                exif_getter=exif_getter,
                context=RuleContext(
                    gps_lat=None,
                    gps_lon=None,
                    user_default_tz="UTC",
                ),
            )
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


SAN_FRANCISCO = (37.7749, -122.4194)
# 2025-06-01 23:30 in San Francisco (UTC-07:00 in summer) is 06:30 UTC on the 2nd.
LOCAL_EVENING = datetime.datetime(2025, 6, 1, 23, 30, tzinfo=pytz.utc)


def _read(exif_values, rules=None, gps=(None, None), default_tz="UTC"):
    """What ``rules`` (the default list) read from a file with ``exif_values``."""

    def exif_getter(tags):
        return [exif_values.get(tag) for tag in tags]

    return extract_local_date_time(
        path="/photos/IMG_0001.jpg",
        rules=as_rules(DEFAULT_RULES_PARAMS if rules is None else rules),
        exif_getter=exif_getter,
        context=RuleContext(gps_lat=gps[0], gps_lon=gps[1], user_default_tz=default_tz),
    )


def _predefined(rule_id):
    return next(rule for rule in PREDEFINED_RULES_PARAMS if rule["id"] == rule_id)


class UtcValueOfALocalTimeTagTest(TestCase):
    """#2767: a local-time tag written in UTC ("...Z") is turned into local time."""

    def test_the_offset_tag_converts_it(self):
        found = _read(
            {
                Tags.DATE_CREATED: "2025:06:02 06:30:00Z",
                Tags.DATE_TIME_ORIGINAL: "2025:06:01 23:30:00",
                Tags.OFFSET_TIME_ORIGINAL: "-07:00",
            }
        )
        self.assertEqual(CaptureTime(LOCAL_EVENING, -420, 16), found)

    def test_without_an_offset_tag_the_gps_zone_converts_it(self):
        found = _read(
            {Tags.DATE_CREATED: "2025:06:02 06:30:00Z"},
            gps=SAN_FRANCISCO,
            default_tz="Europe/Berlin",
        )
        self.assertEqual(CaptureTime(LOCAL_EVENING, -420, 16), found)

    def test_without_gps_the_owners_zone_converts_it(self):
        found = _read(
            {Tags.DATE_CREATED: "2025:06:02 06:30:00Z"},
            default_tz="Europe/Berlin",
        )
        self.assertEqual(
            CaptureTime(datetime.datetime(2025, 6, 2, 8, 30, tzinfo=pytz.utc), 120, 16),
            found,
        )

    def test_an_unusable_offset_tag_is_skipped(self):
        found = _read(
            {
                Tags.DATE_CREATED: "2025:06:02 06:30:00Z",
                Tags.OFFSET_TIME_ORIGINAL: "   :  ",
            },
            gps=SAN_FRANCISCO,
        )
        self.assertEqual(CaptureTime(LOCAL_EVENING, -420, 16), found)

    def test_fractional_seconds_before_the_z(self):
        found = _read(
            {
                Tags.DATE_TIME_ORIGINAL: "2025:06:02 06:30:00.25Z",
                Tags.OFFSET_TIME_ORIGINAL: "-07:00",
            }
        )
        self.assertEqual(CaptureTime(LOCAL_EVENING, -420, 1), found)

    def test_modify_date_goes_with_offset_time(self):
        found = _read(
            {
                Tags.DATE_TIME: "2025:06:02 06:30:00Z",
                Tags.OFFSET_TIME_ORIGINAL: "+09:00",
                Tags.OFFSET_TIME: "-07:00",
            }
        )
        self.assertEqual(CaptureTime(LOCAL_EVENING, -420, 15), found)

    def test_a_rule_that_transforms_the_zone_itself_is_left_alone(self):
        # Rule 11 reads Composite:GPSDateTime as UTC and converts it already.
        found = _read({Tags.GPS_DATE_TIME: "2025:06:02 06:30:00Z"}, gps=SAN_FRANCISCO)
        self.assertEqual(CaptureTime(LOCAL_EVENING, -420, 11), found)

    def test_the_gps_time_in_utc_rule_keeps_utc(self):
        # Rule 13 keeps UTC on purpose: it does not know the zone.
        found = _read(
            {Tags.GPS_DATE_TIME: "2025:06:02 06:30:00Z"},
            rules=[_predefined(13)],
            gps=SAN_FRANCISCO,
        )
        self.assertEqual(
            CaptureTime(
                datetime.datetime(2025, 6, 2, 6, 30, tzinfo=pytz.utc), None, 13
            ),
            found,
        )

    def test_a_transform_rule_on_a_local_time_tag_reads_no_offset_tag(self):
        rule = TimeExtractionRule(
            {
                "rule_type": "exif",
                "exif_tag": Tags.DATE_TIME_ORIGINAL,
                "transform_tz": 1,
                "source_tz": "utc",
                "report_tz": "name:Asia/Tokyo",
            }
        )
        self.assertEqual({Tags.DATE_TIME_ORIGINAL}, rule.get_required_exif_tags())
        found = rule.apply(
            "/photos/IMG_0001.jpg",
            {Tags.DATE_TIME_ORIGINAL: "2025:06:01 23:30:00Z"},
            RuleContext(None, None, "UTC"),
        )
        self.assertEqual(
            CaptureTime(datetime.datetime(2025, 6, 2, 8, 30, tzinfo=pytz.utc), 540),
            found,
        )


class CaptureTimeOffsetTest(TestCase):
    """#2768: the rules hand back the UTC offset of the time they read."""

    def test_the_offset_tag_of_the_camera_date(self):
        found = _read(
            {
                Tags.DATE_TIME_ORIGINAL: "2025:06:01 23:30:00",
                Tags.OFFSET_TIME_ORIGINAL: "-07:00",
            }
        )
        self.assertEqual(CaptureTime(LOCAL_EVENING, -420, 1), found)

    def test_an_offset_written_after_the_time_wins_over_the_offset_tag(self):
        found = _read(
            {
                Tags.DATE_CREATED: "2025:06:01 23:30:00+05:30",
                Tags.OFFSET_TIME_ORIGINAL: "-07:00",
            }
        )
        self.assertEqual(CaptureTime(LOCAL_EVENING, 330, 16), found)

    def test_without_offset_information_the_offset_is_unknown(self):
        found = _read({Tags.DATE_TIME_ORIGINAL: "2025:06:01 23:30:00"})
        self.assertEqual(CaptureTime(LOCAL_EVENING, None, 1), found)

    def test_a_phone_videos_creation_date_states_its_offset(self):
        found = _read(
            {
                Tags.QUICKTIME_CREATION_DATE: "2025:06:01 23:30:00-07:00",
                Tags.QUICKTIME_CREATE_DATE: "2025:06:02 06:30:00",
            }
        )
        self.assertEqual(CaptureTime(LOCAL_EVENING, -420, 17), found)

    def test_a_utc_video_date_gets_the_gps_zones_offset_of_that_day(self):
        # Rule 2; San Francisco is UTC-08:00 in winter, UTC-07:00 in summer.
        winter = _read(
            {Tags.QUICKTIME_CREATE_DATE: "2025:01:02 06:30:00"}, gps=SAN_FRANCISCO
        )
        summer = _read(
            {Tags.QUICKTIME_CREATE_DATE: "2025:06:02 06:30:00"}, gps=SAN_FRANCISCO
        )
        self.assertEqual(
            CaptureTime(
                datetime.datetime(2025, 1, 1, 22, 30, tzinfo=pytz.utc), -480, 2
            ),
            winter,
        )
        self.assertEqual(CaptureTime(LOCAL_EVENING, -420, 2), summer)

    def test_a_file_name_date_has_no_offset(self):
        found = extract_local_date_time(
            path="/photos/IMG_20250601_233000.jpg",
            rules=as_rules(DEFAULT_RULES_PARAMS),
            exif_getter=lambda tags: [None] * len(tags),
            context=RuleContext(None, None, "Europe/Berlin"),
        )
        self.assertEqual(CaptureTime(LOCAL_EVENING, None, 3), found)

    def test_the_server_zone_reports_the_servers_offset(self):
        rule = TimeExtractionRule(
            {
                "rule_type": "exif",
                "exif_tag": Tags.QUICKTIME_CREATE_DATE,
                "transform_tz": 1,
                "source_tz": "utc",
                "report_tz": "server_local",
            }
        )
        found = rule.apply(
            "/videos/clip.mp4",
            {Tags.QUICKTIME_CREATE_DATE: "2025:06:02 06:30:00"},
            RuleContext(None, None, "UTC"),
        )
        local = datetime.datetime(2025, 6, 2, 6, 30, tzinfo=pytz.utc).astimezone()
        offset = local.utcoffset()
        assert found is not None and offset is not None
        self.assertEqual(int(offset.total_seconds()) // 60, found.utc_offset)

    def test_a_rule_id_that_is_not_a_number_is_not_kept(self):
        for rule_id in ("custom", True, None, -1, 2**31):
            with self.subTest(rule_id=rule_id):
                found = _read(
                    {Tags.DATE_TIME_ORIGINAL: "2025:06:01 23:30:00"},
                    rules=[
                        {
                            "id": rule_id,
                            "rule_type": "exif",
                            "exif_tag": Tags.DATE_TIME_ORIGINAL,
                        }
                    ],
                )
                self.assertEqual(CaptureTime(LOCAL_EVENING), found)

    def test_out_of_range_offsets_are_ignored(self):
        for value in ("+15:00", "-07:60", "07:00", "-7:00", 420):
            with self.subTest(value=value):
                found = _read(
                    {
                        Tags.DATE_TIME_ORIGINAL: "2025:06:01 23:30:00",
                        Tags.OFFSET_TIME_ORIGINAL: value,
                    }
                )
                self.assertEqual(CaptureTime(LOCAL_EVENING, None, 1), found)

    def test_offsets_without_a_colon_are_read(self):
        found = _read(
            {
                Tags.DATE_TIME_ORIGINAL: "2025:06:01 23:30:00",
                Tags.OFFSET_TIME_ORIGINAL: "-0700",
            }
        )
        self.assertEqual(CaptureTime(LOCAL_EVENING, -420, 1), found)

    def test_the_local_time_rules_ask_for_their_offset_tag(self):
        self.assertEqual(
            {
                16: {Tags.DATE_CREATED, Tags.OFFSET_TIME_ORIGINAL},
                1: {Tags.DATE_TIME_ORIGINAL, Tags.OFFSET_TIME_ORIGINAL},
                15: {Tags.DATE_TIME, Tags.OFFSET_TIME},
                17: {Tags.QUICKTIME_CREATION_DATE},
                2: {Tags.QUICKTIME_CREATE_DATE},
            },
            {
                rule_id: TimeExtractionRule(
                    _predefined(rule_id)
                ).get_required_exif_tags()
                for rule_id in (16, 1, 15, 17, 2)
            },
        )


def _file_values(values):
    """``get_metadata`` of a file holding ``values``."""
    return patch(
        "api.metadata.photo_datetime.get_metadata",
        side_effect=lambda path, tags, **kwargs: [values.get(tag) for tag in tags],
    )


CAMERA_WITH_OFFSET = {
    Tags.DATE_TIME_ORIGINAL: "2025:06:01 23:30:00",
    Tags.OFFSET_TIME_ORIGINAL: "-07:00",
}


class CaptureTimeStoredTest(TestCase):
    """#2768: the scan stores the offset and the rule next to exif_timestamp."""

    def setUp(self):
        self.user = create_test_user()
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)

    def _scan(self, photo, values):
        with _file_values(values):
            extract_date_time(photo)
        return Photo.objects.get(pk=photo.pk)

    @staticmethod
    def _stored(photo):
        return (
            photo.exif_timestamp,
            photo.exif_timestamp_offset,
            photo.exif_timestamp_source,
        )

    def _edit(self, photo, value):
        with _file_values(CAMERA_WITH_OFFSET):
            response = self.client.patch(
                f"/api/photos/edit/{photo.image_hash}/",
                {"exif_timestamp": value},
                format="json",
            )
        self.assertEqual(200, response.status_code)
        return self._stored(Photo.objects.get(pk=photo.pk))

    def test_the_rules_offset_and_id_are_stored(self):
        photo = self._scan(create_test_photo(owner=self.user), CAMERA_WITH_OFFSET)
        self.assertEqual((LOCAL_EVENING, -420, 1), self._stored(photo))

    def test_a_date_set_by_hand_clears_them_and_removing_it_restores_them(self):
        photo = self._scan(create_test_photo(owner=self.user), CAMERA_WITH_OFFSET)

        self.assertEqual(
            (MANUAL_DATE, None, None), self._edit(photo, MANUAL_DATE.isoformat())
        )
        self.assertEqual((LOCAL_EVENING, -420, 1), self._edit(photo, None))

    def test_a_rescan_of_a_date_set_by_hand_keeps_no_rule(self):
        photo = create_test_photo(
            owner=self.user, timestamp=MANUAL_DATE, exif_timestamp=MANUAL_DATE
        )
        photo = self._scan(photo, CAMERA_WITH_OFFSET)
        self.assertEqual((MANUAL_DATE, None, None), self._stored(photo))

    def test_the_photo_detail_returns_them(self):
        photo = self._scan(
            create_test_photo(owner=self.user),
            {
                Tags.DATE_TIME_ORIGINAL: "2025:06:01 23:30:00",
                Tags.OFFSET_TIME_ORIGINAL: "+05:30",
            },
        )
        body = self.client.get(f"/api/photos/{photo.image_hash}/").json()
        self.assertEqual(
            (330, 1), (body["exif_timestamp_offset"], body["exif_timestamp_source"])
        )

    def test_a_date_set_for_many_photos_clears_them(self):
        photo = self._scan(create_test_photo(owner=self.user), CAMERA_WITH_OFFSET)

        set_capture_times(
            Photo.objects.filter(pk=photo.pk), set_to(MANUAL_DATE), self.user
        )

        photo.refresh_from_db()
        self.assertEqual((MANUAL_DATE, None, None), self._stored(photo))
