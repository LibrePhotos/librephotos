"""A Google Takeout JSON next to a file during the scan (#2270): its capture
time is a date rule after the file's own tags, its position fills a file
without one, its description is the last caption fallback, the scan matches
it once per directory, and a changed JSON makes the photo be read again."""

import datetime
import json
import os
import tempfile
from unittest import mock

from django.test import SimpleTestCase, TestCase

from api.directory_watcher import file_handlers
from api.directory_watcher.scan_jobs import (
    KnownFile,
    _group_needs_processing,
    _partition_scan_paths,
)
from api.metadata import takeout
from api.metadata.datetime_rules import (
    DEFAULT_RULES_PARAMS,
    RuleContext,
    RuleTypes,
    TimeExtractionRule,
)
from api.metadata.photo_datetime import extract_date_time
from api.metadata.photo_reader import EXIF_VALUE_NAMES, extract_exif_data
from api.metadata.tags import Tags
from api.models.photo import LocationSource
from api.models.photo_caption import PhotoCaption
from api.photos.indexed_mtimes import Observed
from api.tests.utils import create_test_file, create_test_photo, create_test_user

UTC = datetime.timezone.utc
# 2019-01-01 12:00:00 UTC
TAKEN = "1546344000"
ZURICH = {"latitude": 47.3769, "longitude": 8.5417, "altitude": 408.0}
TOKYO = (35.6812, 139.7671)


def takeout_json(**fields):
    data = {
        "title": "photo.jpg",
        "description": "",
        "photoTakenTime": {"timestamp": TAKEN},
        "geoData": {"latitude": 0.0, "longitude": 0.0, "altitude": 0.0},
    }
    data.update(fields)
    return data


def rule_ids_before(rule_id):
    ids = [rule["id"] for rule in DEFAULT_RULES_PARAMS]
    return ids[: ids.index(rule_id)]


class TakeoutRuleTest(SimpleTestCase):
    def apply(self, report_tz, taken_at, gps=(None, None)):
        rule = TimeExtractionRule(
            {
                "id": 20,
                "rule_type": RuleTypes.TAKEOUT_JSON,
                "transform_tz": 1,
                "source_tz": "utc",
                "report_tz": report_tz,
            }
        )
        context = RuleContext(
            gps_lat=gps[0],
            gps_lon=gps[1],
            user_default_tz="Europe/Berlin",
            takeout_taken_at=lambda: taken_at,
        )
        return rule.apply("/export/photo.jpg", {}, context)

    def test_the_utc_time_in_the_gps_zone(self):
        self.assertEqual(
            datetime.datetime(2019, 1, 1, 21, 0, tzinfo=UTC),
            self.apply(
                "gps_timezonefinder",
                datetime.datetime(2019, 1, 1, 12, 0, tzinfo=UTC),
                TOKYO,
            ),
        )

    def test_without_gps_the_gps_rule_does_not_apply(self):
        taken = datetime.datetime(2019, 1, 1, 12, 0, tzinfo=UTC)
        self.assertIsNone(self.apply("gps_timezonefinder", taken))

    def test_the_utc_time_in_the_default_zone(self):
        self.assertEqual(
            datetime.datetime(2019, 1, 1, 13, 0, tzinfo=UTC),
            self.apply(
                "user_default", datetime.datetime(2019, 1, 1, 12, 0, tzinfo=UTC)
            ),
        )

    def test_without_a_json_the_rule_does_not_apply(self):
        self.assertIsNone(self.apply("user_default", None))

    def test_without_transform_the_time_stays_utc(self):
        rule = TimeExtractionRule({"id": 99, "rule_type": RuleTypes.TAKEOUT_JSON})
        taken = datetime.datetime(2019, 1, 1, 12, 0, tzinfo=UTC)
        context = RuleContext(None, None, "Europe/Berlin", lambda: taken)
        self.assertEqual(taken, rule.apply("/export/photo.jpg", {}, context))

    def test_the_rules_read_no_tag(self):
        rule = TimeExtractionRule({"id": 20, "rule_type": RuleTypes.TAKEOUT_JSON})
        self.assertEqual(set(), rule.get_required_exif_tags())

    def test_the_default_rules_come_after_the_tags_and_before_the_file_name(self):
        ids = [rule["id"] for rule in DEFAULT_RULES_PARAMS]
        self.assertEqual([20, 21, 3], ids[ids.index(20) : ids.index(3) + 1])
        before = [
            rule for rule in DEFAULT_RULES_PARAMS if rule["id"] in rule_ids_before(20)
        ]
        self.assertTrue(all(rule["rule_type"] == RuleTypes.EXIF for rule in before))


class TakeoutFilesTestCase(TestCase):
    """A photo whose main file sits in a temporary export folder."""

    media_name = "photo.jpg"

    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.directory = directory.name
        self.user = create_test_user(default_timezone="Europe/Berlin")
        path = os.path.join(self.directory, self.media_name)
        main_file = create_test_file(path, self.user, content=b"jpeg" + os.urandom(8))
        self.photo = create_test_photo(owner=self.user, main_file=main_file)

    def write_json(self, data, name=None):
        name = name or self.media_name + ".supplemental-metadata.json"
        path = os.path.join(self.directory, name)
        with open(path, "w", encoding="utf-8") as handle:
            json.dump(data, handle)
        return path


def tag_values(**by_tag):
    def get_metadata(path, tags, **kwargs):
        return [by_tag.get(tag) for tag in tags]

    return get_metadata


class TakeoutDateTest(TakeoutFilesTestCase):
    media_name = "IMG_20180101_101010.jpg"

    def date_of(self, **tags):
        with mock.patch(
            "api.metadata.photo_datetime.get_metadata", side_effect=tag_values(**tags)
        ):
            extract_date_time(self.photo)
        self.photo.refresh_from_db()
        return self.photo.exif_timestamp

    def test_without_gps_the_json_time_in_the_default_zone(self):
        self.write_json(takeout_json())
        self.assertEqual(
            datetime.datetime(2019, 1, 1, 13, 0, tzinfo=UTC), self.date_of()
        )

    def test_with_gps_the_json_time_in_the_zone_of_the_position(self):
        self.photo.exif_gps_lat, self.photo.exif_gps_lon = TOKYO
        self.photo.save()
        self.write_json(takeout_json())
        self.assertEqual(
            datetime.datetime(2019, 1, 1, 21, 0, tzinfo=UTC), self.date_of()
        )

    def test_an_exif_date_wins_and_the_json_is_not_looked_up(self):
        self.write_json(takeout_json())
        with mock.patch("api.metadata.takeout.os.scandir") as scandir:
            date = self.date_of(**{Tags.DATE_TIME_ORIGINAL: "2005:01:02 03:04:05"})
        self.assertEqual(datetime.datetime(2005, 1, 2, 3, 4, 5, tzinfo=UTC), date)
        scandir.assert_not_called()

    def test_without_a_json_the_file_name_dates_the_photo(self):
        self.assertEqual(
            datetime.datetime(2018, 1, 1, 10, 10, 10, tzinfo=UTC), self.date_of()
        )

    def test_a_json_that_is_not_takeout_json_is_ignored(self):
        self.write_json({"title": "photo"}, name=self.media_name + ".json")
        self.assertEqual(
            datetime.datetime(2018, 1, 1, 10, 10, 10, tzinfo=UTC), self.date_of()
        )


class TakeoutValuesTest(TakeoutFilesTestCase):
    def extract(self, **named):
        values = [named.get(name) for name in EXIF_VALUE_NAMES]
        with mock.patch("api.metadata.photo_reader.get_metadata", return_value=values):
            metadata = extract_exif_data(self.photo, commit=True)
        self.photo.refresh_from_db()
        return metadata

    def caption(self):
        return PhotoCaption.objects.get(photo=self.photo).captions_json.get(
            "user_caption"
        )

    def test_the_json_position_when_the_file_has_none(self):
        self.write_json(takeout_json(geoData=ZURICH))
        metadata = self.extract()
        self.assertEqual(
            (47.3769, 8.5417), (self.photo.exif_gps_lat, self.photo.exif_gps_lon)
        )
        self.assertEqual(LocationSource.FILE, self.photo.location_source)
        self.assertEqual(408.0, metadata.gps_altitude)

    def test_the_files_position_wins(self):
        self.write_json(takeout_json(geoData=ZURICH))
        self.extract(gps_latitude=52.52, gps_longitude=13.405)
        self.assertEqual(
            (52.52, 13.405), (self.photo.exif_gps_lat, self.photo.exif_gps_lon)
        )

    def test_null_island_in_the_json_is_no_position(self):
        self.write_json(takeout_json())
        self.extract()
        self.assertIsNone(self.photo.exif_gps_lat)

    def test_the_json_description_is_the_last_caption_fallback(self):
        self.write_json(takeout_json(description="New year at the lake"))
        self.extract()
        self.assertEqual("New year at the lake", self.caption())

    def test_a_description_in_the_file_wins(self):
        self.write_json(takeout_json(description="New year at the lake"))
        self.extract(iptc_caption="From the camera roll")
        self.assertEqual("From the camera roll", self.caption())


def exported(*names):
    return os.path.join(os.sep + "export", *names)


class ScanPartitionTest(SimpleTestCase):
    def test_the_json_joins_its_files_group_and_an_album_json_is_dropped(self):
        paths = [
            exported("2019", "IMG_1.jpg"),
            exported("2019", "IMG_1.jpg.json"),
            exported("2019", "IMG_2.jpg"),
            exported("2019", "metadata.json"),
        ]
        with mock.patch("api.metadata.takeout.os.scandir") as scandir:
            groups, metadata_paths = _partition_scan_paths(paths)
        scandir.assert_not_called()
        self.assertEqual(
            {
                (exported("2019"), "img_1"): paths[:2],
                (exported("2019"), "img_2"): [paths[2]],
            },
            dict(groups),
        )
        self.assertEqual([], metadata_paths)

    def test_a_live_photo_takes_the_json_of_its_image(self):
        paths = [
            exported("IMG_1.MP4"),
            exported("IMG_1.HEIC"),
            exported("IMG_1.HEIC.json"),
        ]
        groups, _ = _partition_scan_paths(paths)
        self.assertEqual(paths, groups[(exported(), "img_1")])

    def test_chosen_files_list_each_directory_once(self):
        with tempfile.TemporaryDirectory() as directory:
            names = ["IMG_1.jpg", "IMG_1.jpg.json", "IMG_2.jpg", "IMG_2.jpg.json"]
            for name in names:
                with open(os.path.join(directory, name), "w") as handle:
                    handle.write("{}")
            paths = [
                os.path.join(directory, name) for name in ("IMG_1.jpg", "IMG_2.jpg")
            ]
            with mock.patch(
                "api.metadata.takeout.os.scandir", wraps=os.scandir
            ) as scandir:
                groups, _ = _partition_scan_paths(paths, walked=False)
        self.assertEqual(1, scandir.call_count)
        self.assertEqual(
            os.path.join(directory, "IMG_2.jpg.json"), groups[(directory, "img_2")][-1]
        )


class _FakeScan:
    started_at = datetime.datetime(2026, 1, 1, tzinfo=UTC)


class TakeoutChangeDetectionTest(SimpleTestCase):
    group = [exported("IMG_1.jpg"), exported("IMG_1.jpg.json")]
    # What the scan recorded of the media file when it read it (#2296).
    recorded = Observed(1_700_000_000_000_000_000)

    def needs_processing(self, modified, known=None, on_disk=recorded):
        known = known or {exported("IMG_1.jpg"): KnownFile("hash")}
        with (
            mock.patch(
                "api.directory_watcher.scan_jobs._file_was_modified_after",
                side_effect=lambda path, time: path in modified,
            ),
            mock.patch(
                "api.directory_watcher.scan_jobs.indexed_mtimes.observe",
                return_value=on_disk,
            ),
        ):
            return _group_needs_processing(self.group, known, False, _FakeScan())

    def test_a_known_photo_with_an_unchanged_json_is_skipped(self):
        self.assertFalse(self.needs_processing(set()))

    def test_changing_only_the_json_reads_the_photo_again(self):
        self.assertTrue(self.needs_processing({exported("IMG_1.jpg.json")}))

    def test_the_media_file_still_counts(self):
        self.assertTrue(self.needs_processing({exported("IMG_1.jpg")}))

    def test_with_a_record_only_the_json_time_is_compared_with_the_last_scan(self):
        known = {exported("IMG_1.jpg"): KnownFile("hash", self.recorded)}
        self.assertFalse(self.needs_processing(set(), known))
        self.assertTrue(self.needs_processing({exported("IMG_1.jpg.json")}, known))
        changed = Observed(self.recorded.mtime_ns + 1)
        self.assertTrue(self.needs_processing(set(), known, on_disk=changed))


class FileGroupTakeoutTest(SimpleTestCase):
    def test_the_group_is_processed_without_its_json_and_without_listing(self):
        seen = {}

        def handle(user, paths, job_id, rebuild_thumbnails=False):
            seen["paths"] = paths
            seen["json"] = takeout.takeout_json_path([exported("IMG_1.jpg")])

        with (
            mock.patch.object(file_handlers, "_handle_media_group", side_effect=handle),
            mock.patch("api.metadata.takeout.os.scandir") as scandir,
        ):
            file_handlers.handle_file_group(
                None, [exported("IMG_1.jpg"), exported("IMG_1.jpg.json")], "job"
            )
        scandir.assert_not_called()
        self.assertEqual([exported("IMG_1.jpg")], seen["paths"])
        self.assertEqual(exported("IMG_1.jpg.json"), seen["json"])
