"""Characterization tests for api/stats.py (CRAP unit 28).

Pins the CURRENT behavior of:
  * ``api.stats.get_server_stats``    (cyclomatic complexity 34)
  * ``api.stats.get_location_clusters`` (cyclomatic complexity 14)

These are characterization tests: they assert what the code does today,
including quirks (see the ``# QUIRK:`` comments), so that a later refactor
can be checked for behavioral equivalence.
"""

from unittest.mock import patch

from django.test import TestCase
from django.utils import timezone

from api.models import AlbumAuto, AlbumPlace, AlbumThing, AlbumUser, Person, Photo
from api.models.user import get_deleted_user
from api.stats import get_location_clusters, get_server_stats
from api.tests.utils import (
    create_test_face,
    create_test_person,
    create_test_photo,
    create_test_user,
)

CPU_INFO = {
    "brand_raw": "Test CPU",
    "arch": "X86_64",
    "bits": 64,
    "count": 8,
}


def _geo(*features):
    return {"features": list(features)}


def _feature(text, center=None):
    f = {"text": text}
    if center is not None:
        f["center"] = center
    return f


class ServerStatsBaseTest(TestCase):
    """Common patching: cpuinfo is slow, torch/cuda must never be probed."""

    def setUp(self):
        cpu_patch = patch("cpuinfo.get_cpu_info", return_value=dict(CPU_INFO))
        self.mock_cpu = cpu_patch.start()
        self.addCleanup(cpu_patch.stop)
        cuda_patch = patch("torch.cuda.is_available", return_value=False)
        cuda_patch.start()
        self.addCleanup(cuda_patch.stop)


class GetServerStatsShapeTest(ServerStatsBaseTest):
    def test_top_level_keys_and_no_users(self):
        # Only the "deleted" sentinel user exists (created lazily by the call).
        stats = get_server_stats()
        self.assertEqual(
            set(stats.keys()),
            {
                "cpu_info",
                "image_tag",
                "available_ram_in_mb",
                "gpu_name",
                "gpu_memory_in_mb",
                "total_storage_in_mb",
                "used_storage_in_mb",
                "free_storage_in_mb",
                "number_of_users",
                "users",
            },
        )
        self.assertEqual(stats["cpu_info"], CPU_INFO)
        self.assertEqual(stats["number_of_users"], 0)
        self.assertEqual(stats["users"], [])
        for key in (
            "available_ram_in_mb",
            "total_storage_in_mb",
            "used_storage_in_mb",
            "free_storage_in_mb",
        ):
            self.assertIsInstance(stats[key], int, key)

    def test_deleted_user_is_excluded_from_counts_and_list(self):
        deleted = get_deleted_user()
        create_test_user()
        create_test_user()
        stats = get_server_stats()
        self.assertEqual(stats["number_of_users"], 2)
        self.assertEqual(len(stats["users"]), 2)
        # sanity: the sentinel really is in the DB
        self.assertTrue(type(deleted).objects.filter(pk=deleted.pk).exists())

    def test_image_tag_comes_from_environment(self):
        with patch.dict("os.environ", {"IMAGE_TAG": "dev-1.2.3"}):
            self.assertEqual(get_server_stats()["image_tag"], "dev-1.2.3")

    def test_image_tag_defaults_to_empty_string(self):
        with patch.dict("os.environ", {}, clear=True):
            self.assertEqual(get_server_stats()["image_tag"], "")


class GetServerStatsGpuBranchTest(ServerStatsBaseTest):
    def test_no_cuda_yields_empty_strings(self):
        stats = get_server_stats()
        # QUIRK: the "no GPU" branch returns "" for gpu_memory_in_mb, not 0/None.
        self.assertEqual(stats["gpu_name"], "")
        self.assertEqual(stats["gpu_memory_in_mb"], "")

    def test_cuda_available_reports_name_and_memory_in_mb(self):
        class _Props:
            total_memory = 8 * 1024 * 1024 * 1024

        with (
            patch("torch.cuda.is_available", return_value=True),
            patch("torch.cuda.get_device_name", return_value="Fake GPU"),
            patch("torch.cuda.get_device_properties", return_value=_Props()),
        ):
            stats = get_server_stats()
        self.assertEqual(stats["gpu_name"], "Fake GPU")
        self.assertEqual(stats["gpu_memory_in_mb"], 8192)


class GetServerStatsCpuCacheCoercionTest(ServerStatsBaseTest):
    def test_cache_fields_coerced_and_unparseable_dropped(self):
        self.mock_cpu.return_value = {
            "brand_raw": "Test CPU",
            "l1_data_cache_size": "1.3 MiB",
            "l1_instruction_cache_size": 32768,
            "l2_cache_size": "garbage",
            # l3_cache_size intentionally absent -> stays absent
        }
        cpu_info = get_server_stats()["cpu_info"]
        self.assertEqual(cpu_info["l1_data_cache_size"], round(1.3 * 1024 * 1024))
        self.assertEqual(cpu_info["l1_instruction_cache_size"], 32768)
        self.assertNotIn("l2_cache_size", cpu_info)
        self.assertNotIn("l3_cache_size", cpu_info)

    def test_float_cache_size_is_truncated_to_int(self):
        self.mock_cpu.return_value = {"l3_cache_size": 1024.9}
        self.assertEqual(get_server_stats()["cpu_info"]["l3_cache_size"], 1024)


class GetServerStatsPerUserTest(ServerStatsBaseTest):
    def setUp(self):
        super().setUp()
        self.user = create_test_user()

    def _user_stats(self):
        stats = get_server_stats()
        self.assertEqual(len(stats["users"]), 1)
        return stats["users"][0]

    def test_user_entry_keys(self):
        entry = self._user_stats()
        self.assertEqual(
            set(entry.keys()),
            {
                "date_joined",
                "total_file_size_in_mb",
                "number_of_photos",
                "number_of_videos",
                "number_of_screenshots",
                "number_of_documents",
                "number_of_captions",
                "number_of_generated_captions",
                "album",
                "person",
                "number_of_clusters",
                "places",
                "things",
                "events",
                "number_of_favorites",
                "number_of_hidden",
                "number_of_public",
            },
        )
        self.assertEqual(
            entry["date_joined"], self.user.date_joined.strftime("%d-%m-%Y")
        )

    def test_empty_user_zero_counts_and_none_aggregates(self):
        entry = self._user_stats()
        for key in (
            "number_of_photos",
            "number_of_videos",
            "number_of_screenshots",
            "number_of_documents",
            "number_of_captions",
            "number_of_generated_captions",
            "number_of_clusters",
            "number_of_favorites",
            "number_of_hidden",
            "number_of_public",
        ):
            self.assertEqual(entry[key], 0, key)
        # QUIRK: no photos -> Sum() is None -> calc_megabytes(None) returns 0.
        self.assertEqual(entry["total_file_size_in_mb"], 0)
        for group in ("album", "places", "things", "events"):
            self.assertEqual(entry[group]["count"], 0)
            for key in ("min", "max", "mean", "median", "median_videos"):
                self.assertIsNone(entry[group][key], f"{group}.{key}")
        self.assertEqual(entry["person"]["count"], 0)
        self.assertIsNone(entry["person"]["median"])

    def test_photo_type_counters(self):
        create_test_photo(owner=self.user, size=2 * 1024 * 1024)
        create_test_photo(owner=self.user, video=True)
        create_test_photo(owner=self.user, is_screenshot=True)
        create_test_photo(owner=self.user, is_document=True)
        create_test_photo(owner=self.user, hidden=True)
        create_test_photo(owner=self.user, public=True)
        create_test_photo(owner=self.user, rating=5)
        # another user's photo must not leak in
        create_test_photo(owner=create_test_user())

        stats = get_server_stats()
        entry = next(u for u in stats["users"] if u["number_of_photos"] == 7)
        self.assertEqual(entry["number_of_videos"], 1)
        self.assertEqual(entry["number_of_screenshots"], 1)
        self.assertEqual(entry["number_of_documents"], 1)
        self.assertEqual(entry["number_of_hidden"], 1)
        self.assertEqual(entry["number_of_public"], 1)
        # favorite_min_rating defaults to 4 -> only the rating=5 photo counts
        self.assertEqual(entry["number_of_favorites"], 1)
        self.assertEqual(entry["total_file_size_in_mb"], 2)

    def test_caption_counters(self):
        create_test_photo(
            owner=self.user, captions_json={"user_caption": "hi", "places365": {}}
        )
        create_test_photo(owner=self.user, captions_json={"im2txt": "a dog"})
        create_test_photo(owner=self.user, captions_json={"places365": {}})
        create_test_photo(owner=self.user)
        entry = self._user_stats()
        self.assertEqual(entry["number_of_captions"], 1)
        self.assertEqual(entry["number_of_generated_captions"], 1)

    def test_album_group_aggregates(self):
        p1 = create_test_photo(owner=self.user)
        p2 = create_test_photo(owner=self.user, video=True)
        p3 = create_test_photo(owner=self.user)
        a1 = AlbumUser.objects.create(title="a1", owner=self.user)
        a1.photos.add(p1, p2, p3)
        a2 = AlbumUser.objects.create(title="a2", owner=self.user)
        a2.photos.add(p2)

        album = self._user_stats()["album"]
        self.assertEqual(album["count"], 2)
        self.assertEqual(album["min"], 1)
        self.assertEqual(album["max"], 3)
        self.assertEqual(album["mean"], 2.0)
        self.assertEqual(album["median"], 2)
        # video-filtered counts: a1 has 1 video, a2 has 1 video
        self.assertEqual(album["min_videos"], 1)
        self.assertEqual(album["max_videos"], 1)
        self.assertEqual(album["mean_videos"], 1.0)
        self.assertEqual(album["median_videos"], 1)

    def test_zero_aggregates_are_reported_as_none(self):
        # QUIRK: the `or None` idiom converts a legitimate 0 min/mean into None.
        photo = create_test_photo(owner=self.user)  # not a video
        album = AlbumUser.objects.create(title="only-photos", owner=self.user)
        album.photos.add(photo)
        empty = AlbumUser.objects.create(title="empty", owner=self.user)
        self.assertEqual(empty.photos.count(), 0)

        stats = self._user_stats()["album"]
        self.assertEqual(stats["count"], 2)
        self.assertIsNone(stats["min"])  # real min is 0
        self.assertEqual(stats["max"], 1)
        self.assertEqual(stats["mean"], 0.5)
        # median over [0, 1] -> Decimal average, not None
        self.assertEqual(float(stats["median"]), 0.5)
        self.assertIsNone(stats["min_videos"])  # real min is 0
        self.assertIsNone(stats["max_videos"])  # real max is 0 too
        self.assertIsNone(stats["mean_videos"])  # real mean is 0.0
        self.assertEqual(stats["median_videos"], 0)  # median is NOT `or None`-ed

    def test_person_group_counts_faces(self):
        person = create_test_person(cluster_owner=self.user)
        photo = create_test_photo(owner=self.user)
        create_test_face(photo=photo, person=person)
        create_test_face(photo=photo, person=person)
        create_test_person(cluster_owner=self.user)  # 0 faces

        person_stats = self._user_stats()["person"]
        self.assertEqual(person_stats["count"], 2)
        self.assertIsNone(person_stats["min"])  # 0 -> None (quirk)
        self.assertEqual(person_stats["max"], 2)
        self.assertEqual(person_stats["mean"], 1.0)
        self.assertEqual(float(person_stats["median"]), 1.0)
        self.assertNotIn("min_videos", person_stats)

    def test_places_things_events_groups(self):
        photo = create_test_photo(owner=self.user)
        video = create_test_photo(owner=self.user, video=True)
        place = AlbumPlace.objects.create(title="Berlin", owner=self.user)
        place.photos.add(photo, video)
        thing = AlbumThing.objects.create(
            title="dog", thing_type="places365", owner=self.user
        )
        thing.photos.add(photo)
        event = AlbumAuto.objects.create(
            title="Trip",
            owner=self.user,
            timestamp=timezone.now(),
            created_on=timezone.now(),
        )
        event.photos.add(video)

        entry = self._user_stats()
        self.assertEqual(entry["places"]["count"], 1)
        self.assertEqual(entry["places"]["max"], 2)
        self.assertEqual(entry["places"]["max_videos"], 1)
        self.assertEqual(entry["things"]["count"], 1)
        self.assertEqual(entry["things"]["max"], 1)
        self.assertIsNone(entry["things"]["max_videos"])  # 0 -> None
        self.assertEqual(entry["events"]["count"], 1)
        self.assertEqual(entry["events"]["max"], 1)
        self.assertEqual(entry["events"]["max_videos"], 1)

    def test_owner_scoping_between_users(self):
        other = create_test_user()
        create_test_photo(owner=self.user)
        create_test_photo(owner=other)
        create_test_photo(owner=other)
        Person.objects.all().delete()

        stats = get_server_stats()
        counts = sorted(u["number_of_photos"] for u in stats["users"])
        self.assertEqual(counts, [1, 2])
        self.assertEqual(stats["number_of_users"], 2)
        self.assertEqual(Photo.objects.count(), 3)


class GetLocationClustersTest(TestCase):
    def setUp(self):
        self.user = create_test_user()

    def test_no_photos_returns_empty_list(self):
        self.assertEqual(get_location_clusters(self.user), [])

    def test_returns_lat_lon_text_sorted_by_name(self):
        create_test_photo(
            owner=self.user,
            geolocation_json=_geo(_feature("Zurich", [8.5, 47.4])),
        )
        create_test_photo(
            owner=self.user,
            geolocation_json=_geo(_feature("Berlin", [13.4, 52.5])),
        )
        res = get_location_clusters(self.user)
        # center is [lon, lat]; the result rows are [lat, lon, text]
        self.assertEqual(
            res,
            [
                [52.5, 13.4, "Berlin"],
                [47.4, 8.5, "Zurich"],
            ],
        )

    def test_first_occurrence_per_name_wins(self):
        create_test_photo(
            owner=self.user, geolocation_json=_geo(_feature("Paris", [2.0, 48.0]))
        )
        create_test_photo(
            owner=self.user, geolocation_json=_geo(_feature("Paris", [99.0, 99.0]))
        )
        res = get_location_clusters(self.user)
        self.assertEqual(len(res), 1)
        # NOTE: "first" is DB iteration order, which is not explicitly ordered;
        # only one of the two centers survives.
        self.assertIn(res[0], [[48.0, 2.0, "Paris"], [99.0, 99.0, "Paris"]])

    def test_all_features_of_a_photo_are_used(self):
        create_test_photo(
            owner=self.user,
            geolocation_json=_geo(
                _feature("Germany", [10.0, 51.0]),
                _feature("Bavaria", [11.0, 49.0]),
                _feature("Munich", [11.5, 48.1]),
            ),
        )
        res = get_location_clusters(self.user)
        self.assertEqual([r[2] for r in res], ["Bavaria", "Germany", "Munich"])

    def test_numeric_location_names_are_skipped(self):
        create_test_photo(
            owner=self.user,
            geolocation_json=_geo(
                _feature("12345", [1.0, 2.0]),
                _feature("-42", [1.0, 2.0]),
                _feature("12a", [3.0, 4.0]),
                _feature("Real Place", [5.0, 6.0]),
            ),
        )
        res = get_location_clusters(self.user)
        # "12a" is not fully numeric -> kept.
        self.assertEqual(sorted(r[2] for r in res), ["12a", "Real Place"])

    def test_missing_or_malformed_center_is_skipped(self):
        create_test_photo(
            owner=self.user,
            geolocation_json=_geo(
                _feature("NoCenter"),
                {"text": "ShortCenter", "center": [1.0]},
                {"text": "DictCenter", "center": {"lat": 1, "lon": 2}},
                {"text": "BadFloats", "center": ["abc", "def"]},
                _feature("Good", [7.0, 8.0]),
            ),
        )
        self.assertEqual(get_location_clusters(self.user), [[8.0, 7.0, "Good"]])

    def test_string_coordinates_are_coerced_to_float(self):
        create_test_photo(
            owner=self.user,
            geolocation_json=_geo({"text": "StrCoords", "center": ["1.5", "2.5"]}),
        )
        self.assertEqual(get_location_clusters(self.user), [[2.5, 1.5, "StrCoords"]])

    def test_empty_or_missing_text_is_skipped(self):
        create_test_photo(
            owner=self.user,
            geolocation_json=_geo(
                {"center": [1.0, 2.0]},
                {"text": "", "center": [1.0, 2.0]},
                {"text": None, "center": [1.0, 2.0]},
            ),
        )
        self.assertEqual(get_location_clusters(self.user), [])

    def test_non_dict_features_are_skipped(self):
        create_test_photo(
            owner=self.user,
            geolocation_json={
                "features": ["a string", 42, None, _feature("OK", [1.0, 2.0])]
            },
        )
        self.assertEqual(get_location_clusters(self.user), [[2.0, 1.0, "OK"]])

    def test_geolocation_json_shapes_that_yield_nothing(self):
        create_test_photo(owner=self.user, geolocation_json=None)  # excluded by query
        create_test_photo(owner=self.user, geolocation_json={})
        create_test_photo(owner=self.user, geolocation_json={"features": []})
        # a list payload: `(geo or {}).get` raises AttributeError, which is swallowed
        create_test_photo(owner=self.user, geolocation_json=["not", "a", "dict"])
        self.assertEqual(get_location_clusters(self.user), [])

    def test_features_not_a_list_raises_type_error(self):
        # QUIRK: a non-iterable "features" value is NOT defended against; the
        # try/except only guards the .get() call, not the iteration.
        create_test_photo(owner=self.user, geolocation_json={"features": 5})
        with self.assertRaises(TypeError):
            get_location_clusters(self.user)

    def test_results_are_scoped_to_the_owner(self):
        other = create_test_user()
        create_test_photo(
            owner=self.user, geolocation_json=_geo(_feature("Mine", [1.0, 2.0]))
        )
        create_test_photo(
            owner=other, geolocation_json=_geo(_feature("Theirs", [3.0, 4.0]))
        )
        self.assertEqual([r[2] for r in get_location_clusters(self.user)], ["Mine"])
        self.assertEqual([r[2] for r in get_location_clusters(other)], ["Theirs"])
