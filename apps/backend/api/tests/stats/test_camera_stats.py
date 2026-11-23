from django.test import TestCase
from rest_framework.test import APIClient

from api.dataviz.stats import get_camera_stats
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


class CameraStatsTest(TestCase):
    def setUp(self):
        self.user = create_test_user()

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
                    "label": "Dacia Phone",
                    "value": "Dacia Phone",
                    "make": "",
                    "count": 1,
                },
                {
                    "label": "Canon EOS R5",
                    "value": "EOS R5",
                    "make": "Canon",
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

    def test_lenses_group_by_model(self):
        for _ in range(2):
            create_test_photo(owner=self.user, lens="XF23mmF1.4 R LM WR")
        create_test_photo(owner=self.user, lens="RF24-70mm F2.8 L IS USM")
        self.assertEqual(
            get_camera_stats(self.user)["lenses"],
            [
                {
                    "label": "XF23mmF1.4 R LM WR",
                    "value": "XF23mmF1.4 R LM WR",
                    "count": 2,
                },
                {
                    "label": "RF24-70mm F2.8 L IS USM",
                    "value": "RF24-70mm F2.8 L IS USM",
                    "count": 1,
                },
            ],
        )

    def test_exposure_values_sort_lowest_first(self):
        for iso, aperture, focal in (
            (800, 2.8, 70.0),
            (100, 1.4, 23.0),
            (800, 2.8, 23.0),
        ):
            create_test_photo(
                owner=self.user,
                iso=iso,
                fstop=aperture,
                focal_length=focal,
                focal_length_35mm=int(focal * 1.5),
            )
        stats = get_camera_stats(self.user)
        self.assertEqual(
            stats["iso"],
            [{"value": 100, "count": 1}, {"value": 800, "count": 2}],
        )
        self.assertEqual(
            stats["aperture"],
            [{"value": 1.4, "count": 1}, {"value": 2.8, "count": 2}],
        )
        self.assertEqual(
            stats["focal_length"],
            [{"value": 23.0, "count": 2}, {"value": 70.0, "count": 1}],
        )
        self.assertEqual(
            stats["focal_length_35mm"],
            [{"value": 34, "count": 2}, {"value": 105, "count": 1}],
        )

    def test_shutter_speeds_sort_by_their_seconds(self):
        create_test_photo(
            owner=self.user, shutter_speed="1/250", shutter_speed_seconds=0.004
        )
        create_test_photo(
            owner=self.user, shutter_speed="1/1000", shutter_speed_seconds=0.001
        )
        create_test_photo(owner=self.user, shutter_speed="2", shutter_speed_seconds=2.0)
        create_test_photo(owner=self.user, shutter_speed="odd")
        self.assertEqual(
            get_camera_stats(self.user)["shutter_speed"],
            [
                {"value": "1/1000", "count": 1},
                {"value": "1/250", "count": 1},
                {"value": "2", "count": 1},
                {"value": "odd", "count": 1},
            ],
        )

    def test_blank_and_missing_metadata_counts_nothing(self):
        create_test_photo(owner=self.user)
        create_test_photo(owner=self.user, camera="", lens="", iso=None)
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

    def test_the_endpoint_answers_the_stats(self):
        create_test_photo(
            owner=self.user, camera_make="FUJIFILM", camera="X-T5", iso=400
        )
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
        self.assertEqual(body["iso"], [{"value": 400, "count": 1}])

    def test_needs_a_signed_in_user(self):
        response = APIClient().get("/api/camera-stats/")
        self.assertEqual(response.status_code, 401)
