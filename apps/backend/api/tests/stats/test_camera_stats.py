import datetime

from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from api.dataviz.camera_stats import (
    APERTURE_STOPS,
    FOCAL_EDGES,
    ISO_STOPS,
    SHUTTER_STOPS,
    get_camera_stats,
)
from api.tests.utils import create_test_photo, create_test_user

EMPTY = {
    "cameras": [],
    "lenses": [],
    "iso": [],
    "aperture": [],
    "focal_length": [],
    "focal_length_35mm": [],
    "shutter_speed": [],
}

SEARCH_URL = "/api/photos/searchlist/"


def bucket(label, low, high, count):
    return {"label": label, "min": low, "max": high, "count": count}


class CameraStatsTest(TestCase):
    def setUp(self):
        self.user = create_test_user()

    def photos(self, *values, **fields):
        for value in values:
            create_test_photo(owner=self.user, **{**fields, **value})

    def test_empty_library_has_empty_lists(self):
        self.assertEqual(get_camera_stats(self.user), EMPTY)
        self.assertEqual(list(get_camera_stats(self.user).keys()), list(EMPTY.keys()))

    def test_cameras_group_by_make_and_model_most_photos_first(self):
        for _ in range(3):
            create_test_photo(owner=self.user, camera_make="FUJIFILM", camera="X-T5")
        create_test_photo(owner=self.user, camera_make="Canon", camera="EOS R5")
        create_test_photo(owner=self.user, camera_make="Sony", camera="EOS R5")
        create_test_photo(owner=self.user, camera="Dacia Phone")
        self.assertEqual(
            get_camera_stats(self.user)["cameras"],
            [
                {
                    "label": "FUJIFILM X-T5",
                    "value": "X-T5",
                    "make": "FUJIFILM",
                    "count": 3,
                },
                {
                    "label": "Canon EOS R5",
                    "value": "EOS R5",
                    "make": "Canon",
                    "count": 1,
                },
                {
                    "label": "Dacia Phone",
                    "value": "Dacia Phone",
                    "make": "",
                    "count": 1,
                },
                {"label": "Sony EOS R5", "value": "EOS R5", "make": "Sony", "count": 1},
            ],
        )

    def test_a_camera_model_named_by_its_maker_names_it_once(self):
        create_test_photo(
            owner=self.user, camera_make="NIKON CORPORATION", camera="NIKON D850"
        )
        self.assertEqual(
            get_camera_stats(self.user)["cameras"],
            [
                {
                    "label": "NIKON D850",
                    "value": "NIKON D850",
                    "make": "NIKON CORPORATION",
                    "count": 1,
                }
            ],
        )

    def test_cameras_group_ignoring_case_as_the_search_matches(self):
        self.photos(
            {"camera_make": "Apple", "camera": "iPhone 15 Pro"},
            {"camera_make": "Apple", "camera": "iPhone 15 Pro"},
            {"camera_make": "APPLE", "camera": "IPHONE 15 PRO"},
        )
        self.assertEqual(
            get_camera_stats(self.user)["cameras"],
            [
                {
                    "label": "Apple iPhone 15 Pro",
                    "value": "iPhone 15 Pro",
                    "make": "Apple",
                    "count": 3,
                }
            ],
        )

    def test_a_model_with_photos_without_a_maker_is_one_row_searching_the_model(self):
        self.photos(
            {"camera_make": "Apple", "camera": "iPhone 15 Pro"},
            {"camera": "iPhone 15 Pro"},
            {"camera": "iphone 15 pro"},
        )
        self.assertEqual(
            get_camera_stats(self.user)["cameras"],
            [
                {
                    "label": "Apple iPhone 15 Pro",
                    "value": "iPhone 15 Pro",
                    "make": "",
                    "count": 3,
                }
            ],
        )

    def test_lenses_group_by_model_ignoring_case(self):
        for _ in range(2):
            create_test_photo(owner=self.user, lens="XF23mmF1.4 R LM WR")
        create_test_photo(owner=self.user, lens="xf23mmf1.4 r lm wr")
        create_test_photo(owner=self.user, lens="RF24-70mm F2.8 L IS USM")
        self.assertEqual(
            get_camera_stats(self.user)["lenses"],
            [
                {
                    "label": "XF23mmF1.4 R LM WR",
                    "value": "XF23mmF1.4 R LM WR",
                    "count": 3,
                },
                {
                    "label": "RF24-70mm F2.8 L IS USM",
                    "value": "RF24-70mm F2.8 L IS USM",
                    "count": 1,
                },
            ],
        )

    def test_iso_buckets_on_third_stops_with_the_photos_own_bounds(self):
        self.photos(*({"iso": iso} for iso in (51, 64, 100, 103, 400, 400, 640, 25)))
        self.assertEqual(
            get_camera_stats(self.user)["iso"],
            [
                bucket("25", 25, 25, 1),
                bucket("50", 51, 51, 1),
                bucket("64", 64, 64, 1),
                bucket("100", 100, 103, 2),
                bucket("400", 400, 400, 2),
                bucket("640", 640, 640, 1),
            ],
        )

    def test_apertures_bucket_on_third_stops(self):
        self.photos(*({"fstop": f} for f in (1.78, 1.69, 1.8, 2.8, 2.2, 1.5)))
        self.assertEqual(
            get_camera_stats(self.user)["aperture"],
            [
                bucket("f/1.6", 1.5, 1.5, 1),
                bucket("f/1.8", 1.69, 1.8, 3),
                bucket("f/2.2", 2.2, 2.2, 1),
                bucket("f/2.8", 2.8, 2.8, 1),
            ],
        )

    def test_focal_lengths_bucket_in_mm_bands(self):
        self.photos(
            *(
                {"focal_length": mm, "focal_length_35mm": eq}
                for mm, eq in (
                    (4.25, 13),
                    (5.1, 24),
                    (6.86, 26),
                    (6.86, 77),
                    (900, 900),
                )
            )
        )
        stats = get_camera_stats(self.user)
        self.assertEqual(
            stats["focal_length"],
            [
                bucket("4–5 mm", 4.25, 4.25, 1),
                bucket("5–6 mm", 5.1, 5.1, 1),
                bucket("6–7 mm", 6.86, 6.86, 2),
                bucket("800+ mm", 900, 900, 1),
            ],
        )
        self.assertEqual(
            stats["focal_length_35mm"],
            [
                bucket("12–14 mm", 13, 13, 1),
                bucket("24–28 mm", 24, 26, 2),
                bucket("70–85 mm", 77, 77, 1),
                bucket("800+ mm", 900, 900, 1),
            ],
        )

    def test_shutter_speeds_bucket_in_whole_stops_of_seconds(self):
        self.photos(
            *(
                {"shutter_speed_seconds": seconds}
                for seconds in (1 / 33, 1 / 30, 1 / 121, 1 / 125, 1 / 250, 2.0, 600.0)
            )
        )
        create_test_photo(owner=self.user, shutter_speed="odd")
        self.assertEqual(
            get_camera_stats(self.user)["shutter_speed"],
            [
                bucket("1/250", 1 / 250, 1 / 250, 1),
                bucket("1/125", 1 / 125, 1 / 121, 2),
                bucket("1/30", 1 / 33, 1 / 30, 2),
                bucket("2 s", 2.0, 2.0, 1),
                bucket("8 min", 600.0, 600.0, 1),
            ],
        )

    def test_values_past_the_scales_fall_in_the_end_buckets(self):
        self.photos(
            {"iso": 1, "fstop": 0.5, "shutter_speed_seconds": 1 / 100000},
            {"iso": 10_000_000, "fstop": 500, "shutter_speed_seconds": 100_000.0},
        )
        stats = get_camera_stats(self.user)
        self.assertEqual(
            [row["label"] for row in stats["iso"]],
            [str(ISO_STOPS[0]), str(ISO_STOPS[-1])],
        )
        self.assertEqual(
            [row["label"] for row in stats["aperture"]],
            [f"f/{APERTURE_STOPS[0]}", f"f/{APERTURE_STOPS[-1]}"],
        )
        self.assertEqual(
            [row["label"] for row in stats["shutter_speed"]],
            [SHUTTER_STOPS[0], SHUTTER_STOPS[-1]],
        )

    def test_the_bucket_count_is_bounded_by_the_scales(self):
        self.photos(
            *(
                {
                    "iso": 50 + step,
                    "fstop": 1 + step / 100,
                    "focal_length": 4 + step / 10,
                    "focal_length_35mm": 10 + step,
                    "shutter_speed_seconds": 1 / (10 + step),
                }
                for step in range(300)
            )
        )
        stats = get_camera_stats(self.user)
        self.assertLessEqual(len(stats["iso"]), len(ISO_STOPS))
        self.assertLessEqual(len(stats["aperture"]), len(APERTURE_STOPS))
        self.assertLessEqual(len(stats["focal_length"]), len(FOCAL_EDGES))
        self.assertLessEqual(len(stats["focal_length_35mm"]), len(FOCAL_EDGES))
        self.assertLessEqual(len(stats["shutter_speed"]), len(SHUTTER_STOPS))
        for name in ("iso", "aperture", "focal_length", "shutter_speed"):
            with self.subTest(name):
                self.assertEqual(sum(row["count"] for row in stats[name]), 300)

    def test_blank_zero_and_missing_metadata_counts_nothing(self):
        create_test_photo(owner=self.user)
        create_test_photo(owner=self.user, camera="", lens="", iso=None)
        create_test_photo(owner=self.user, iso=0, fstop=0, focal_length=0)
        self.assertEqual(get_camera_stats(self.user), EMPTY)

    def test_another_users_photos_never_count(self):
        create_test_photo(owner=create_test_user(), camera="Stranger Cam", iso=6400)
        self.assertEqual(get_camera_stats(self.user), EMPTY)

    def test_hidden_trashed_and_removed_photos_never_count(self):
        create_test_photo(owner=self.user, camera="Hidden Cam", hidden=True)
        create_test_photo(owner=self.user, camera="Trashed Cam", in_trashcan=True)
        create_test_photo(owner=self.user, camera="Removed Cam", removed=True)
        self.assertEqual(get_camera_stats(self.user), EMPTY)


class CameraStatsViewTest(TestCase):
    def setUp(self):
        self.user = create_test_user()
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)

    def photo(self, **fields):
        taken = timezone.make_aware(datetime.datetime(2024, 3, 10, 12))
        return create_test_photo(owner=self.user, exif_timestamp=taken, **fields)

    def search_count(self, params):
        response = self.client.get(SEARCH_URL, params)
        self.assertEqual(response.status_code, 200, response.data)
        return sum(len(day["items"]) for day in response.data["results"])

    def test_the_endpoint_answers_the_stats(self):
        self.photo(camera_make="FUJIFILM", camera="X-T5", iso=400)
        body = self.client.get("/api/camera-stats/").json()
        self.assertEqual(set(body.keys()), set(EMPTY.keys()))
        self.assertEqual(
            body["cameras"],
            [
                {
                    "label": "FUJIFILM X-T5",
                    "value": "X-T5",
                    "make": "FUJIFILM",
                    "count": 1,
                }
            ],
        )
        self.assertEqual(body["iso"], [bucket("400", 400, 400, 1)])

    def test_every_bucket_searches_exactly_its_photos(self):
        for iso, aperture, focal, eq, seconds in (
            (51, 1.78, 4.25, 13, 1 / 33),
            (64, 1.69, 5.1, 24, 1 / 121),
            (103, 2.2, 6.86, 26, 1 / 125),
            (100, 1.8, 6.86, 77, 1 / 60),
            (3200, 2.8, 70.0, 105, 2.0),
        ):
            self.photo(
                iso=iso,
                fstop=aperture,
                focal_length=focal,
                focal_length_35mm=eq,
                shutter_speed_seconds=seconds,
            )
        body = self.client.get("/api/camera-stats/").json()
        for stat, prefix in (
            ("iso", "iso"),
            ("aperture", "aperture"),
            ("focal_length", "focal"),
            ("focal_length_35mm", "focal35"),
            ("shutter_speed", "shutter"),
        ):
            for row in body[stat]:
                with self.subTest(stat=stat, label=row["label"]):
                    params = {f"{prefix}_min": row["min"], f"{prefix}_max": row["max"]}
                    if prefix in ("iso", "focal35"):
                        params = {key: int(value) for key, value in params.items()}
                    self.assertEqual(self.search_count(params), row["count"])

    def test_every_camera_row_searches_exactly_its_photos(self):
        self.photo(camera_make="Apple", camera="iPhone 15 Pro")
        self.photo(camera="IPHONE 15 PRO")
        self.photo(camera_make="Canon", camera="EOS R5")
        self.photo(camera_make="CANON", camera="eos r5")
        self.photo(camera_make="Sony", camera="EOS R5")
        body = self.client.get("/api/camera-stats/").json()
        self.assertEqual(len(body["cameras"]), 3)
        for row in body["cameras"]:
            with self.subTest(row["label"]):
                params = {"camera": row["value"]}
                if row["make"]:
                    params["make"] = row["make"]
                self.assertEqual(self.search_count(params), row["count"])

    def test_needs_a_signed_in_user(self):
        response = APIClient().get("/api/camera-stats/")
        self.assertEqual(response.status_code, 401)
