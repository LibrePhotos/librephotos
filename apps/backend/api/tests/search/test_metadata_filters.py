"""The structured search filters (#2259) and the people filter (#329).

``/api/photos/searchlist/`` narrows by camera, lens, exposure, rating,
capture days, location, file type and people, with or without a search
term; a select-all ``query`` with the same keys (``build_photo_queryset``)
acts on exactly the listed photos; ``/api/search/metadata-values/`` suggests
the requester's cameras, makers and lenses.
"""

import datetime
from unittest.mock import patch

from django.db import connection
from django.test import TestCase
from django.test.utils import CaptureQueriesContext
from django.utils import timezone
from rest_framework.test import APIClient

from api.models import File
from api.models.photo_stack import PhotoStack
from api.photos.selection import build_photo_queryset
from api.search.metadata_filter import metadata_filter_q, parse_metadata_filter
from api.tests.utils import (
    create_test_face,
    create_test_file,
    create_test_person,
    create_test_photo,
    create_test_stack,
    create_test_user,
)

SEARCH_URL = "/api/photos/searchlist/"
VALUES_URL = "/api/search/metadata-values/"


def _day(year, month, day, hour=12, minute=0):
    return timezone.make_aware(datetime.datetime(year, month, day, hour, minute))


def _hashes(response):
    """The image hashes of a date-grouped or flat (semantic) search answer."""
    hashes = []
    for entry in response.data["results"]:
        items = entry["items"] if "items" in entry else [entry]
        hashes += [item["image_hash"] for item in items]
    return hashes


class MetadataFilterTestCase(TestCase):
    def setUp(self):
        self.user = create_test_user()
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)

    def photo(self, **fields):
        fields.setdefault("exif_timestamp", _day(2024, 3, 10))
        return create_test_photo(owner=self.user, **fields)

    def search(self, params, status=200):
        response = self.client.get(SEARCH_URL, params)
        self.assertEqual(response.status_code, status, response.data)
        return response

    def assert_matches(self, params, expected):
        hashes = _hashes(self.search(params))
        self.assertEqual(len(hashes), len(set(hashes)), "a photo is listed twice")
        self.assertEqual(set(hashes), {photo.image_hash for photo in expected})

    def assert_refused(self, params, field):
        response = self.search(params, status=400)
        self.assertIn(field, [error["field"] for error in response.data["errors"]])


class CameraAndExposureFilterTest(MetadataFilterTestCase):
    def setUp(self):
        super().setUp()
        self.xt5 = self.photo(
            camera_make="FUJIFILM",
            camera="X-T5",
            lens="XF23mmF1.4 R LM WR",
            iso=3200,
            aperture=1.4,
            focal_length=23.0,
            focal_length_35mm=35,
        )
        self.r5 = self.photo(
            camera_make="Canon",
            camera="Canon EOS R5",
            lens="RF24-70mm F2.8 L IS USM",
            iso=100,
            aperture=2.8,
            focal_length=70.0,
            focal_length_35mm=70,
        )
        self.no_metadata = self.photo()

    def test_no_filter_lists_everything(self):
        self.assert_matches({}, [self.xt5, self.r5, self.no_metadata])

    def test_camera_matches_the_model_exactly_ignoring_case(self):
        self.assert_matches({"camera": "x-t5"}, [self.xt5])
        self.assert_matches({"camera": "X-T"}, [])

    def test_make_and_lens(self):
        self.assert_matches({"make": "canon"}, [self.r5])
        self.assert_matches({"lens": "XF23mmF1.4 R LM WR"}, [self.xt5])

    def test_ranges_are_inclusive(self):
        self.assert_matches({"iso_min": 3200}, [self.xt5])
        self.assert_matches({"iso_max": 100}, [self.r5])
        self.assert_matches({"iso_min": 100, "iso_max": 3200}, [self.xt5, self.r5])
        self.assert_matches({"aperture_min": 1.4, "aperture_max": 2}, [self.xt5])
        self.assert_matches({"focal_min": 70}, [self.r5])
        self.assert_matches({"focal_max": 23}, [self.xt5])
        self.assert_matches({"focal35_min": 35, "focal35_max": 35}, [self.xt5])

    def test_filters_combine_with_and(self):
        self.assert_matches({"make": "fujifilm", "iso_max": 400}, [])
        self.assert_matches({"make": "fujifilm", "iso_min": 400}, [self.xt5])

    def test_combines_with_a_search_term(self):
        beach = self.photo(camera="X-T5", search_captions="beach")
        self.photo(camera="Canon EOS R5", search_captions="beach")
        self.assert_matches({"search": "beach", "camera": "X-T5"}, [beach])

    def test_combines_with_the_media_filter(self):
        clip = self.photo(camera="X-T5", video=True)
        self.assert_matches({"camera": "X-T5", "video": "true"}, [clip])

    def test_another_users_photos_never_match(self):
        create_test_photo(
            owner=create_test_user(), camera="X-T5", exif_timestamp=_day(2024, 3, 10)
        )
        self.assert_matches({"camera": "X-T5"}, [self.xt5])

    def test_bad_numbers_are_refused_naming_the_parameter(self):
        self.assert_refused({"iso_min": "a lot"}, "iso_min")
        self.assert_refused({"aperture_max": "-1"}, "aperture_max")
        self.assert_refused({"focal35_min": "1.5"}, "focal35_min")

    def test_a_lowest_value_above_its_highest_is_refused(self):
        self.assert_refused({"iso_min": 800, "iso_max": 400}, "iso_max")
        self.assert_refused({"focal_min": 50, "focal_max": 20}, "focal_max")

    def test_the_filter_also_narrows_semantic_search(self):
        self.user.semantic_search_topk = 10
        self.user.save()
        hashes = [self.xt5.image_hash, self.r5.image_hash]
        with (
            patch(
                "api.search.filters.calculate_query_embeddings",
                return_value=([0.1] * 512, 1.0),
            ),
            patch("api.search.filters.search_similar_embedding", return_value=hashes),
        ):
            self.assert_matches({"search": "anything", "camera": "X-T5"}, [self.xt5])


class RatingDateAndLocationFilterTest(MetadataFilterTestCase):
    def test_rating_min(self):
        four = self.photo(rating=4)
        five = self.photo(rating=5)
        self.photo(rating=0)
        self.assert_matches({"rating_min": 4}, [four, five])
        self.assert_matches({"rating_min": 5}, [five])

    def test_rating_min_is_one_to_five(self):
        self.assert_refused({"rating_min": 6}, "rating_min")
        self.assert_refused({"rating_min": 0}, "rating_min")

    def test_taken_days_are_inclusive(self):
        first = self.photo(exif_timestamp=_day(2024, 3, 1, 0, 0))
        last = self.photo(exif_timestamp=_day(2024, 5, 31, 23, 59))
        leap_day = self.photo(exif_timestamp=_day(2024, 2, 29, 23, 59))
        self.june = self.photo(exif_timestamp=_day(2024, 6, 1, 0, 0))
        self.photo(exif_timestamp=None)
        self.assert_matches(
            {"taken_after": "2024-03-01", "taken_before": "2024-05-31"},
            [first, last],
        )
        self.assert_matches({"taken_before": "2024-03-01"}, [leap_day, first])
        self.assert_matches({"taken_after": "2024-03-01"}, [first, last, self.june])

    def test_bad_days_are_refused(self):
        self.assert_refused({"taken_after": "March"}, "taken_after")
        self.assert_refused(
            {"taken_after": "2024-06-01", "taken_before": "2024-05-01"},
            "taken_before",
        )

    def test_has_location(self):
        placed = self.photo(exif_gps_lat=48.1, exif_gps_lon=11.6)
        nowhere = self.photo()
        half = self.photo(exif_gps_lat=48.1)
        self.assert_matches({"has_location": "true"}, [placed])
        self.assert_matches({"has_location": "false"}, [nowhere, half])
        self.assert_refused({"has_location": "maybe"}, "has_location")

    def test_has_location_false_lists_the_without_location_page(self):
        self.photo(exif_gps_lat=48.1, exif_gps_lon=11.6)
        self.photo()
        self.photo(exif_gps_lon=11.6)
        page = self.client.get("/api/photos/nolocation/")
        self.assertEqual(
            {photo["image_hash"] for photo in page.data["results"]},
            set(_hashes(self.search({"has_location": "false"}))),
        )


class FileFilterTest(MetadataFilterTestCase):
    def main_file(self, name, file_type):
        return create_test_file(f"/photos/{name}", self.user, file_type=file_type)

    def test_file_type(self):
        jpeg = self.photo(main_file=self.main_file("a.jpg", File.IMAGE))
        clip = self.photo(main_file=self.main_file("b.mp4", File.VIDEO))
        raw_main = self.photo(main_file=self.main_file("c.CR3", File.RAW_FILE))
        paired = self.photo(main_file=self.main_file("d.jpg", File.IMAGE))
        paired.files.add(self.main_file("d.raf", File.RAW_FILE))
        self.assert_matches({"file_type": "image"}, [jpeg, paired])
        self.assert_matches({"file_type": "video"}, [clip])
        self.assert_matches({"file_type": "raw"}, [raw_main, paired])
        self.assert_refused({"file_type": "gif"}, "file_type")

    def test_extension_with_or_without_the_dot_ignoring_case(self):
        raw_main = self.photo(main_file=self.main_file("c.CR3", File.RAW_FILE))
        self.photo(main_file=self.main_file("a.jpg", File.IMAGE))
        self.assert_matches({"extension": "cr3"}, [raw_main])
        self.assert_matches({"extension": ".CR3"}, [raw_main])

    def test_an_unknown_extension_is_refused(self):
        self.assert_refused({"extension": "exe"}, "extension")


class PeopleFilterTest(MetadataFilterTestCase):
    def setUp(self):
        super().setUp()
        self.alice = create_test_person(name="Alice", cluster_owner=self.user)
        self.bob = create_test_person(name="Bob", cluster_owner=self.user)
        self.both = self.photo()
        create_test_face(photo=self.both, person=self.alice)
        create_test_face(photo=self.both, person=self.bob)
        # Two faces of Alice: still one result.
        create_test_face(photo=self.both, person=self.alice)
        self.alice_only = self.photo()
        create_test_face(photo=self.alice_only, person=self.alice)
        self.bob_removed = self.photo()
        create_test_face(photo=self.bob_removed, person=self.alice)
        create_test_face(photo=self.bob_removed, person=self.bob, deleted=True)

    def test_one_person(self):
        self.assert_matches(
            {"person": self.alice.id}, [self.both, self.alice_only, self.bob_removed]
        )

    def test_every_listed_person_must_be_in_the_photo(self):
        self.assert_matches({"person": [self.alice.id, self.bob.id]}, [self.both])

    def test_combines_with_another_filter(self):
        self.both.rating = 5
        self.both.save()
        self.assert_matches({"person": [self.alice.id], "rating_min": 5}, [self.both])

    def test_another_users_person_is_refused(self):
        stranger = create_test_person(name="Eve", cluster_owner=create_test_user())
        response = self.search({"person": [self.alice.id, stranger.id]}, status=400)
        self.assertEqual(response.data["errors"][0]["field"], "person")
        self.assertNotIn("Eve", str(response.data))

    def test_an_unknown_or_malformed_id_is_refused(self):
        self.assert_refused({"person": 999999}, "person")
        self.assert_refused({"person": "alice"}, "person")

    def test_query_count_does_not_grow_with_the_results(self):
        def queries():
            with CaptureQueriesContext(connection) as ctx:
                self.search({"person": [self.alice.id, self.bob.id]})
            return len(ctx.captured_queries)

        queries()  # warm the per-request caches
        before = queries()
        for _ in range(6):
            photo = self.photo()
            create_test_face(photo=photo, person=self.alice)
            create_test_face(photo=photo, person=self.bob)
        self.assertEqual(queries(), before)


class SelectAllMatchesSearchTest(MetadataFilterTestCase):
    """Select-all with the search's filters acts on exactly what it listed."""

    def setUp(self):
        super().setUp()
        self.alice = create_test_person(name="Alice", cluster_owner=self.user)
        self.bob = create_test_person(name="Bob", cluster_owner=self.user)
        for index in range(6):
            photo = self.photo(
                camera="X-T5" if index % 2 else "X100V",
                iso=200 * (index + 1),
                rating=index % 6,
                exif_timestamp=_day(2024, 3, 1 + index),
                exif_gps_lat=48.1 if index % 3 else None,
                exif_gps_lon=11.6 if index % 3 else None,
            )
            create_test_face(photo=photo, person=self.alice)
            if index > 1:
                create_test_face(photo=photo, person=self.bob)
                create_test_face(photo=photo, person=self.bob)
        create_test_photo(
            owner=create_test_user(), camera="X-T5", exif_timestamp=_day(2024, 3, 2)
        )
        # Search lists the other photos of a stack too; the timeline does not.
        primary = self.photo(camera="X-T5", exif_timestamp=_day(2024, 3, 3))
        self.stacked = self.photo(camera="X-T5", exif_timestamp=_day(2024, 3, 3))
        stack = create_test_stack(
            owner=self.user,
            stack_type=PhotoStack.StackType.MANUAL,
            primary_photo=primary,
        )
        stack.photos.add(primary, self.stacked)

    def assert_same_photos(self, params, select_all_query):
        listed = set(_hashes(self.search(params)))
        self.assertTrue(listed, "the case lists nothing")
        selected = list(
            build_photo_queryset(self.user, select_all_query).values_list(
                "image_hash", flat=True
            )
        )
        self.assertEqual(len(selected), len(set(selected)))
        self.assertEqual(set(selected), listed)

    def test_select_all_matches_the_filtered_search(self):
        cases = [
            {"camera": "x-t5"},
            {"iso_min": 400, "iso_max": 1000},
            {"rating_min": 2},
            {"taken_after": "2024-03-02", "taken_before": "2024-03-04"},
            {"has_location": True},
            {"has_location": False},
            {"person": [self.alice.id, self.bob.id]},
            {"person": [self.bob.id], "camera": "X-T5", "has_location": True},
        ]
        for case in cases:
            with self.subTest(case):
                query_string = {
                    key: str(value).lower() if isinstance(value, bool) else value
                    for key, value in case.items()
                }
                self.assert_same_photos(
                    query_string, {**case, "show_all_stack_photos": True}
                )

    def test_without_the_stack_flag_select_all_keeps_to_the_timelines_photos(self):
        selected = build_photo_queryset(self.user, {"camera": "X-T5"})
        self.assertNotIn(self.stacked, selected)

    def test_the_person_page_sends_one_id(self):
        selected = build_photo_queryset(self.user, {"person": self.bob.id})
        self.assertEqual(selected.count(), 4)

    def test_a_bad_value_in_the_query_is_a_400_on_query(self):
        response = self.client.post(
            "/api/photosedit/favorite/",
            {"select_all": True, "query": {"iso_min": "lots"}, "favorite": True},
            format="json",
        )
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.data["errors"][0]["field"], "query")
        self.assertIn("iso_min", response.data["errors"][0]["message"])

    def test_another_users_person_in_the_query_is_a_400(self):
        stranger = create_test_person(cluster_owner=create_test_user())
        response = self.client.post(
            "/api/photosedit/favorite/",
            {"select_all": True, "query": {"person": [stranger.id]}, "favorite": True},
            format="json",
        )
        self.assertEqual(response.status_code, 400)

    def test_parsed_filters_build_one_q_per_condition(self):
        filters = parse_metadata_filter(
            self.user,
            {"camera": "X-T5", "iso_min": 100, "person": [self.alice.id, self.bob.id]},
        )
        self.assertEqual(len(metadata_filter_q(filters)), 4)


class MetadataValuesTest(MetadataFilterTestCase):
    def test_lists_the_requesters_values_most_photos_first(self):
        for camera in ("X-T5", "X-T5", "X-T5", "X100V", "GR III", "GR III", ""):
            self.photo(camera=camera, camera_make="FUJIFILM")
        self.photo()  # no metadata at all
        self.photo(camera="Hidden Cam", hidden=True)
        create_test_photo(owner=create_test_user(), camera="Stranger Cam")
        response = self.client.get(VALUES_URL, {"field": "camera"})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            response.data["results"],
            [
                {"value": "X-T5", "count": 3},
                {"value": "GR III", "count": 2},
                {"value": "X100V", "count": 1},
            ],
        )

    def test_make_and_lens(self):
        self.photo(camera_make="FUJIFILM", lens="XF23mmF1.4 R LM WR")
        for field, value in (("make", "FUJIFILM"), ("lens", "XF23mmF1.4 R LM WR")):
            with self.subTest(field):
                response = self.client.get(VALUES_URL, {"field": field})
                self.assertEqual(
                    response.data["results"], [{"value": value, "count": 1}]
                )

    def test_an_unknown_field_is_refused(self):
        for params in ({"field": "iso"}, {}):
            with self.subTest(params):
                response = self.client.get(VALUES_URL, params)
                self.assertEqual(response.status_code, 400)
                self.assertEqual(response.data["errors"][0]["field"], "field")

    def test_needs_a_signed_in_user(self):
        response = APIClient().get(VALUES_URL, {"field": "camera"})
        self.assertEqual(response.status_code, 401)
