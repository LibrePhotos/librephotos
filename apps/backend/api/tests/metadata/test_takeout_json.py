"""Finding and reading Google Takeout JSON sidecars (``api.metadata.takeout``, #2270).

The names follow what Google Takeout writes, as other importers document it
(Memories' ``MigrateGoogleTakeout``, PhotoPrism's ``json_gphotos``, the
GooglePhotosTakeoutHelper and gfoto-metadata-fixer notes): ``<file>.json``,
``<file>.supplemental-metadata.json``, the name before the counter and
``.json`` cut to 46 characters, the counter of a second file of the same name
moved to the end, and the JSON of an edited copy shared with the original.
"""

import json
import os
import tempfile
from datetime import datetime, timezone
from unittest import mock

from django.test import SimpleTestCase

from api.metadata import takeout
from api.metadata.takeout import (
    TAKEOUT_JSON_MAX_BYTES,
    JsonListing,
    TakeoutMetadata,
    find_takeout_json,
    parse_takeout_json,
    read_takeout_json,
)

UTC = timezone.utc

# A Takeout JSON as Google writes it (2024 export, trimmed of the fields
# LibrePhotos does not read).
TAKEOUT_JSON = {
    "title": "IMG_20190101_120000.jpg",
    "description": "New year at the lake",
    "imageViews": "3",
    "creationTime": {"timestamp": "1546351200", "formatted": "Jan 1, 2019"},
    "photoTakenTime": {
        "timestamp": "1546344000",
        "formatted": "Jan 1, 2019, 12:00:00 PM UTC",
    },
    "geoData": {
        "latitude": 47.3769,
        "longitude": 8.5417,
        "altitude": 408.0,
        "latitudeSpan": 0.0,
        "longitudeSpan": 0.0,
    },
    "geoDataExif": {
        "latitude": 0.0,
        "longitude": 0.0,
        "altitude": 0.0,
        "latitudeSpan": 0.0,
        "longitudeSpan": 0.0,
    },
    "url": "https://photos.google.com/photo/AF1Qip",
    "googlePhotosOrigin": {"mobileUpload": {"deviceType": "ANDROID_PHONE"}},
}

# 47 characters, as a phone's portrait shot can be.
LONG_NAME = "PXL_20230715_181512345.PORTRAIT.ORIGINAL-01.jpg"


def found(media_name, *json_names):
    path = find_takeout_json(
        os.path.join("/export", media_name), JsonListing.of(json_names)
    )
    return None if path is None else os.path.basename(path)


class FindTakeoutJsonTest(SimpleTestCase):
    def test_the_file_name_with_json(self):
        self.assertEqual("IMG_1.jpg.json", found("IMG_1.jpg", "IMG_1.jpg.json"))

    def test_the_supplemental_metadata_name_of_newer_exports(self):
        self.assertEqual(
            "IMG_1.jpg.supplemental-metadata.json",
            found("IMG_1.jpg", "IMG_1.jpg.supplemental-metadata.json"),
        )

    def test_no_json_for_the_file(self):
        self.assertIsNone(found("IMG_1.jpg", "IMG_2.jpg.json", "metadata.json"))

    def test_an_album_metadata_json_is_not_a_files_json(self):
        self.assertIsNone(found("metadata.jpg", "metadata.json"))

    def test_the_json_of_another_extension_is_not_it(self):
        self.assertIsNone(found("IMG_1.mp4", "IMG_1.jpg.json"))

    def test_a_supplemental_suffix_cut_to_46_characters(self):
        # 26 + 20 characters before ".json" (gfoto-metadata-fixer's example).
        media = "IMG_20180214_171835513.jpg"
        json_name = "IMG_20180214_171835513.jpg.supplemental-metada.json"
        self.assertEqual(json_name, found(media, json_name))

    def test_a_short_supplemental_cut(self):
        media = "IMG_20180214_171835513_BURST001_COVER.jpg"  # 41 characters
        self.assertEqual(
            "IMG_20180214_171835513_BURST001_COVER.jpg.supp.json",
            found(media, "IMG_20180214_171835513_BURST001_COVER.jpg.supp.json"),
        )

    def test_a_long_media_name_cut_to_46_characters(self):
        json_name = LONG_NAME[:46] + ".json"
        self.assertEqual(json_name, found(LONG_NAME, json_name))

    def test_a_media_name_cut_inside_its_extension(self):
        media = "Screenshot_20230715-181512_Google Maps app.jpg"  # 46 characters
        self.assertEqual(media + ".json", found(media, media + ".json"))
        media = "Screenshot_20230715-181512_Google Maps apps.jpg"  # 47
        self.assertEqual(media[:46] + ".json", found(media, media[:46] + ".json"))
        self.assertTrue(media[:46].endswith(".jp"))

    def test_the_counter_of_a_second_file_moves_to_the_end(self):
        self.assertEqual(
            "IMG_1.jpg(1).json", found("IMG_1(1).jpg", "IMG_1.jpg(1).json")
        )
        self.assertEqual(
            "IMG_20180214_171835513.jpg.supplemental-metada(1).json",
            found(
                "IMG_20180214_171835513(1).jpg",
                "IMG_20180214_171835513.jpg.supplemental-metada(1).json",
                "IMG_20180214_171835513.jpg.supplemental-metada.json",
            ),
        )

    def test_the_second_file_does_not_take_the_firsts_json(self):
        self.assertIsNone(found("IMG_1(1).jpg", "IMG_1.jpg.json"))

    def test_a_name_with_brackets_of_its_own(self):
        self.assertEqual("IMG(1).jpg.json", found("IMG(1).jpg", "IMG(1).jpg.json"))

    def test_an_edited_copy_shares_the_originals_json(self):
        self.assertEqual("IMG_1.jpg.json", found("IMG_1-edited.jpg", "IMG_1.jpg.json"))
        self.assertEqual(
            "IMG_1.jpg.supplemental-metadata.json",
            found("IMG_1-bearbeitet.jpg", "IMG_1.jpg.supplemental-metadata.json"),
        )

    def test_a_name_cut_at_another_length_matches_by_prefix(self):
        json_name = LONG_NAME[:44] + ".json"
        self.assertEqual(json_name, found(LONG_NAME, json_name))

    def test_two_files_fitting_one_cut_name_take_neither(self):
        listing = (LONG_NAME[:44] + ".json", LONG_NAME[:45] + ".json")
        self.assertIsNone(found(LONG_NAME, *listing))

    def test_a_short_prefix_never_matches(self):
        self.assertIsNone(found("IMG_1.jpg", "IMG_.json"))

    def test_decomposed_accents_match_composed_ones(self):
        decomposed = "Café.jpg"
        self.assertEqual("Café.jpg.json", found(decomposed, "Café.jpg.json"))

    def test_the_path_is_in_the_media_files_directory(self):
        path = find_takeout_json(
            os.path.join("/export", "2019", "IMG_1.jpg"),
            JsonListing.of(["IMG_1.jpg.json"]),
        )
        self.assertEqual(os.path.join("/export", "2019", "IMG_1.jpg.json"), path)


class ParseTakeoutJsonTest(SimpleTestCase):
    def test_capture_time_position_and_description(self):
        self.assertEqual(
            TakeoutMetadata(
                taken_at=datetime(2019, 1, 1, 12, 0, tzinfo=UTC),
                latitude=47.3769,
                longitude=8.5417,
                altitude=408.0,
                description="New year at the lake",
            ),
            parse_takeout_json(TAKEOUT_JSON),
        )

    def test_a_numeric_timestamp(self):
        data = {**TAKEOUT_JSON, "photoTakenTime": {"timestamp": 1546344000}}
        self.assertEqual(
            datetime(2019, 1, 1, 12, 0, tzinfo=UTC), parse_takeout_json(data).taken_at
        )

    def test_without_photo_taken_time_it_is_not_takeout_json(self):
        for data in (
            {"title": "Album", "description": ""},
            {**TAKEOUT_JSON, "photoTakenTime": {"timestamp": "0"}},
            {**TAKEOUT_JSON, "photoTakenTime": {"timestamp": "soon"}},
            {**TAKEOUT_JSON, "photoTakenTime": "1546344000"},
            [TAKEOUT_JSON],
            "text",
        ):
            with self.subTest(data=data):
                self.assertIsNone(parse_takeout_json(data))

    def test_null_island_is_no_position(self):
        data = {**TAKEOUT_JSON, "geoData": TAKEOUT_JSON["geoDataExif"]}
        self.assertIsNone(parse_takeout_json(data).position)

    def test_the_exif_position_when_geo_data_has_none(self):
        data = {
            **TAKEOUT_JSON,
            "geoData": {"latitude": 0.0, "longitude": 0.0},
            "geoDataExif": {"latitude": 52.52, "longitude": 13.405, "altitude": 34},
        }
        metadata = parse_takeout_json(data)
        self.assertEqual((52.52, 13.405), metadata.position)
        self.assertEqual(34.0, metadata.altitude)

    def test_an_impossible_position_is_none(self):
        data = {**TAKEOUT_JSON, "geoData": {"latitude": 147.0, "longitude": 8.5}}
        self.assertIsNone(parse_takeout_json(data).position)

    def test_an_empty_description_is_none(self):
        data = {**TAKEOUT_JSON, "description": "  "}
        self.assertIsNone(parse_takeout_json(data).description)


class ReadTakeoutJsonTest(SimpleTestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)

    def write(self, name, content):
        path = os.path.join(self.directory.name, name)
        with open(path, "wb") as handle:
            handle.write(content if isinstance(content, bytes) else content.encode())
        return path

    def test_a_takeout_json(self):
        path = self.write("IMG_1.jpg.json", json.dumps(TAKEOUT_JSON))
        self.assertEqual(parse_takeout_json(TAKEOUT_JSON), read_takeout_json(path))

    def test_malformed_json_is_skipped_with_a_warning(self):
        path = self.write("IMG_1.jpg.json", '{"photoTakenTime": ')
        with self.assertLogs("api.metadata.takeout", "WARNING"):
            self.assertIsNone(read_takeout_json(path))

    def test_json_that_is_not_utf8_is_skipped(self):
        path = self.write("IMG_1.jpg.json", b"\xff\xfe\x00{")
        with self.assertLogs("api.metadata.takeout", "WARNING"):
            self.assertIsNone(read_takeout_json(path))

    def test_an_oversized_file_is_skipped_unread(self):
        path = self.write("IMG_1.jpg.json", b" " * (TAKEOUT_JSON_MAX_BYTES + 1))
        with (
            mock.patch("api.metadata.takeout.open", create=True) as opened,
            self.assertLogs("api.metadata.takeout", "WARNING"),
        ):
            self.assertIsNone(read_takeout_json(path))
        opened.assert_not_called()

    def test_a_missing_file_is_skipped(self):
        with self.assertLogs("api.metadata.takeout", "WARNING"):
            self.assertIsNone(
                read_takeout_json(os.path.join(self.directory.name, "x.json"))
            )


class DirectoryListingsTest(SimpleTestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.directory = directory.name
        self.media = os.path.join(self.directory, "IMG_1.jpg")
        for name in ("IMG_1.jpg", "IMG_2.jpg"):
            with open(os.path.join(self.directory, name), "wb") as handle:
                handle.write(b"x")
        with open(self.media + ".json", "w") as handle:
            json.dump(TAKEOUT_JSON, handle)

    def test_outside_a_block_the_directory_is_listed(self):
        self.assertEqual(self.media + ".json", takeout.takeout_json_path([self.media]))
        self.assertEqual(
            "New year at the lake", takeout.takeout_metadata_for(self.media).description
        )

    def test_a_missing_directory_has_no_json(self):
        missing = os.path.join(self.directory, "gone", "IMG_1.jpg")
        self.assertIsNone(takeout.takeout_metadata_for(missing))

    def test_inside_a_block_each_directory_is_listed_and_each_json_read_once(self):
        with (
            mock.patch("api.metadata.takeout.os.scandir", wraps=os.scandir) as scandir,
            mock.patch(
                "api.metadata.takeout.read_takeout_json", wraps=read_takeout_json
            ) as read,
            takeout.directory_listings(),
        ):
            for _ in range(3):
                takeout.takeout_metadata_for(self.media)
                takeout.takeout_metadata_for(os.path.join(self.directory, "IMG_2.jpg"))
        self.assertEqual(1, scandir.call_count)
        self.assertEqual(1, read.call_count)

    def test_known_names_are_not_listed(self):
        with (
            mock.patch("api.metadata.takeout.os.scandir") as scandir,
            takeout.directory_listings({self.directory: []}),
        ):
            self.assertIsNone(takeout.takeout_metadata_for(self.media))
        scandir.assert_not_called()
        with takeout.directory_listings({self.directory: ["IMG_1.jpg.json"]}):
            self.assertEqual(
                datetime(2019, 1, 1, 12, 0, tzinfo=UTC),
                takeout.takeout_metadata_for(self.media).taken_at,
            )

    def test_the_block_ends_with_its_listings(self):
        with takeout.directory_listings({self.directory: []}):
            pass
        self.assertIsNotNone(takeout.takeout_metadata_for(self.media))
