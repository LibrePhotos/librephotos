"""Characterization tests for api/serializers/photos.py (CRAP unit 25).

Pins the CURRENT behavior of:
  * ``PhotoEditSerializer.update``
  * ``PhotoSerializer.get_stacks`` (the detailed one, used by the photo detail view)

These are behavior snapshots taken before refactoring - they encode what the
code does today, including quirks noted in the docstrings below.

Heavy dependencies are mocked: ``reverse_geocode`` is patched at the
``api.serializers.photos`` import site and ``_extract_date_time_from_exif`` is
patched on the model, so no exiftool binary or network access is required.
"""

from unittest.mock import patch

from django.test import TestCase

from api.models.album_place import AlbumPlace, get_album_place
from api.models.photo import Photo
from api.models.photo_metadata import PhotoMetadata
from api.models.photo_search import PhotoSearch
from api.models.photo_stack import PhotoStack
from api.serializers.photos import PhotoEditSerializer, PhotoSerializer
from api.tests.utils import create_test_photo, create_test_user

GEO_RESULT = {
    "features": [
        {"text": "Berlin"},
        {"text": "Germany"},
    ],
    "places": ["Berlin", "Germany"],
    "address": "Berlin, Germany",
}


def _edit(photo, data):
    """Run PhotoEditSerializer as the API does and return the saved instance."""
    serializer = PhotoEditSerializer(photo, data=data, partial=True)
    assert serializer.is_valid(), serializer.errors
    return serializer.save()


class PhotoEditSerializerCategoryTestCase(TestCase):
    """Media-category override branch of ``PhotoEditSerializer.update``."""

    def setUp(self):
        self.user = create_test_user()
        self.photo = create_test_photo(owner=self.user)

    def test_setting_is_screenshot_marks_category_source_user(self):
        result = _edit(self.photo, {"is_screenshot": True})

        self.assertTrue(result.is_screenshot)
        self.assertEqual(result.category_source, "user")
        self.photo.refresh_from_db()
        self.assertTrue(self.photo.is_screenshot)
        self.assertEqual(self.photo.category_source, "user")

    def test_setting_is_document_false_still_marks_user(self):
        """Any explicit write - even False - flips category_source to 'user'."""
        result = _edit(self.photo, {"is_document": False})

        self.assertFalse(result.is_document)
        self.assertEqual(result.category_source, "user")

    def test_both_category_flags_written_together(self):
        result = _edit(self.photo, {"is_screenshot": True, "is_document": True})

        self.photo.refresh_from_db()
        self.assertTrue(self.photo.is_screenshot)
        self.assertTrue(self.photo.is_document)
        self.assertEqual(result.category_source, "user")

    def test_category_source_is_read_only_and_cannot_be_set_by_client(self):
        _edit(self.photo, {"category_source": "auto", "is_screenshot": True})

        self.photo.refresh_from_db()
        self.assertEqual(self.photo.category_source, "user")

    def test_no_category_field_leaves_category_source_untouched(self):
        result = _edit(self.photo, {"hidden": True})

        self.assertEqual(result.category_source, "auto")
        self.photo.refresh_from_db()
        self.assertEqual(self.photo.category_source, "auto")


class PhotoEditSerializerIgnoredFieldsTestCase(TestCase):
    """QUIRK: ``update`` never calls ``super().update`` - most writable fields
    declared in ``Meta.fields`` are silently dropped."""

    def setUp(self):
        self.user = create_test_user()
        self.photo = create_test_photo(owner=self.user)

    def test_hidden_and_rating_are_not_persisted(self):
        result = _edit(self.photo, {"hidden": True, "rating": 4})

        # Returned instance is the untouched in-memory object
        self.assertFalse(result.hidden)
        self.assertEqual(result.rating, 0)
        self.photo.refresh_from_db()
        self.assertFalse(self.photo.hidden)
        self.assertEqual(self.photo.rating, 0)

    def test_in_trashcan_and_removed_are_not_persisted(self):
        _edit(self.photo, {"in_trashcan": True, "removed": True})

        self.photo.refresh_from_db()
        self.assertFalse(self.photo.in_trashcan)
        self.assertFalse(self.photo.removed)

    def test_update_returns_the_same_instance_object(self):
        result = _edit(self.photo, {})
        self.assertIs(result, self.photo)


class PhotoEditSerializerTimestampTestCase(TestCase):
    def setUp(self):
        self.user = create_test_user()
        self.photo = create_test_photo(owner=self.user)

    @patch.object(Photo, "_extract_date_time_from_exif")
    def test_exif_timestamp_is_written_to_timestamp_field(self, extract):
        result = _edit(self.photo, {"exif_timestamp": "2020-01-02T03:04:05Z"})

        self.assertIsNotNone(result.timestamp)
        self.assertEqual(result.timestamp.year, 2020)
        self.assertEqual(result.timestamp.month, 1)
        extract.assert_called_once_with()

        self.photo.refresh_from_db()
        self.assertEqual(self.photo.timestamp.year, 2020)

    @patch.object(Photo, "_extract_date_time_from_exif")
    def test_exif_timestamp_absent_does_not_call_extractor(self, extract):
        _edit(self.photo, {"is_screenshot": True})
        extract.assert_not_called()

    @patch.object(Photo, "_extract_date_time_from_exif")
    def test_exif_timestamp_none_is_accepted_and_clears_timestamp(self, extract):
        """exif_timestamp is nullable, so an explicit null flows through."""
        result = _edit(self.photo, {"exif_timestamp": None})

        self.assertIsNone(result.timestamp)
        extract.assert_called_once_with()


class PhotoEditSerializerGpsTestCase(TestCase):
    def setUp(self):
        self.user = create_test_user()
        self.photo = create_test_photo(owner=self.user)

    @patch("api.serializers.photos.reverse_geocode", return_value=dict(GEO_RESULT))
    def test_happy_path_sets_coordinates_geolocation_and_album_places(self, geocode):
        result = _edit(self.photo, {"exif_gps_lat": "52.5", "exif_gps_lon": "13.4"})

        geocode.assert_called_once_with(52.5, 13.4)
        self.assertEqual(float(result.exif_gps_lat), 52.5)
        self.assertEqual(float(result.exif_gps_lon), 13.4)

        self.photo.refresh_from_db()
        self.assertEqual(float(self.photo.exif_gps_lat), 52.5)
        self.assertIsNotNone(self.photo.geolocation_json)
        # The geocode version stamp is added to the stored payload
        self.assertIn("_v", self.photo.geolocation_json)

        # A PhotoSearch row is created and its search_location populated
        search = PhotoSearch.objects.get(photo=self.photo)
        self.assertIsNotNone(search.search_location)

        # One AlbumPlace per non-numeric feature, photo added to each
        names = sorted(
            AlbumPlace.objects.filter(photos=self.photo).values_list("title", flat=True)
        )
        self.assertEqual(names, ["Berlin", "Germany"])

    @patch("api.serializers.photos.reverse_geocode", return_value=dict(GEO_RESULT))
    def test_geolocation_level_is_reverse_feature_index(self, _geocode):
        _edit(self.photo, {"exif_gps_lat": "52.5", "exif_gps_lon": "13.4"})

        berlin = AlbumPlace.objects.get(title="Berlin", owner=self.user)
        germany = AlbumPlace.objects.get(title="Germany", owner=self.user)
        self.assertEqual(berlin.geolocation_level, 2)
        self.assertEqual(germany.geolocation_level, 1)

    @patch(
        "api.serializers.photos.reverse_geocode",
        return_value={
            "features": [{"text": "12345"}, {"no_text": 1}, {"text": "Rome"}]
        },
    )
    def test_numeric_and_textless_features_are_skipped(self, _geocode):
        _edit(self.photo, {"exif_gps_lat": "41.9", "exif_gps_lon": "12.5"})

        titles = sorted(
            AlbumPlace.objects.filter(photos=self.photo).values_list("title", flat=True)
        )
        self.assertEqual(titles, ["Rome"])

    @patch("api.serializers.photos.reverse_geocode", return_value=dict(GEO_RESULT))
    def test_previous_album_places_are_removed(self, _geocode):
        old_place = get_album_place("Paris", owner=self.user)
        old_place.photos.add(self.photo)
        old_place.save()

        _edit(self.photo, {"exif_gps_lat": "52.5", "exif_gps_lon": "13.4"})

        self.assertFalse(old_place.photos.filter(pk=self.photo.pk).exists())
        titles = sorted(
            AlbumPlace.objects.filter(photos=self.photo).values_list("title", flat=True)
        )
        self.assertEqual(titles, ["Berlin", "Germany"])

    @patch("api.serializers.photos.reverse_geocode", return_value=None)
    def test_empty_geocode_result_still_persists_coordinates(self, geocode):
        result = _edit(self.photo, {"exif_gps_lat": "52.5", "exif_gps_lon": "13.4"})

        geocode.assert_called_once()
        self.photo.refresh_from_db()
        self.assertEqual(float(self.photo.exif_gps_lat), 52.5)
        self.assertEqual(float(self.photo.exif_gps_lon), 13.4)
        # geolocation_json untouched, no PhotoSearch and no AlbumPlace created
        self.assertIn(self.photo.geolocation_json, (None, {}))
        self.assertFalse(PhotoSearch.objects.filter(photo=self.photo).exists())
        self.assertFalse(AlbumPlace.objects.filter(photos=self.photo).exists())
        self.assertIs(result, self.photo)

    @patch("api.serializers.photos.reverse_geocode", return_value={"places": ["X"]})
    def test_geocode_result_without_features_key_skips_album_places(self, _geocode):
        _edit(self.photo, {"exif_gps_lat": "52.5", "exif_gps_lon": "13.4"})

        self.photo.refresh_from_db()
        self.assertIn("_v", self.photo.geolocation_json)
        self.assertFalse(AlbumPlace.objects.filter(photos=self.photo).exists())

    @patch(
        "api.serializers.photos.reverse_geocode",
        side_effect=RuntimeError("geocoder exploded"),
    )
    def test_geocode_exception_is_swallowed_but_coordinates_survive(self, _geocode):
        result = _edit(self.photo, {"exif_gps_lat": "52.5", "exif_gps_lon": "13.4"})

        self.assertIs(result, self.photo)
        # The instance was saved before reverse_geocode was called
        self.photo.refresh_from_db()
        self.assertEqual(float(self.photo.exif_gps_lat), 52.5)
        self.assertEqual(float(self.photo.exif_gps_lon), 13.4)

    @patch("api.serializers.photos.reverse_geocode")
    def test_latitude_only_is_ignored_entirely(self, geocode):
        """QUIRK: a partial coordinate pair is popped and dropped - the photo's
        latitude is NOT updated and no geocoding happens."""
        result = _edit(self.photo, {"exif_gps_lat": "52.5"})

        geocode.assert_not_called()
        self.assertIsNone(result.exif_gps_lat)
        self.photo.refresh_from_db()
        self.assertIsNone(self.photo.exif_gps_lat)

    @patch("api.serializers.photos.reverse_geocode")
    def test_longitude_only_is_ignored_entirely(self, geocode):
        _edit(self.photo, {"exif_gps_lon": "13.4"})

        geocode.assert_not_called()
        self.photo.refresh_from_db()
        self.assertIsNone(self.photo.exif_gps_lon)

    @patch("api.serializers.photos.reverse_geocode")
    def test_no_gps_fields_does_not_geocode(self, geocode):
        _edit(self.photo, {"is_screenshot": True})
        geocode.assert_not_called()

    @patch("api.serializers.photos.reverse_geocode", return_value=dict(GEO_RESULT))
    @patch.object(Photo, "_extract_date_time_from_exif")
    def test_category_timestamp_and_gps_can_be_combined(self, extract, geocode):
        result = _edit(
            self.photo,
            {
                "is_screenshot": True,
                "exif_timestamp": "2021-06-07T08:09:10Z",
                "exif_gps_lat": "52.5",
                "exif_gps_lon": "13.4",
            },
        )

        extract.assert_called_once_with()
        geocode.assert_called_once_with(52.5, 13.4)
        self.photo.refresh_from_db()
        self.assertTrue(self.photo.is_screenshot)
        self.assertEqual(self.photo.category_source, "user")
        self.assertEqual(self.photo.timestamp.year, 2021)
        self.assertEqual(float(self.photo.exif_gps_lat), 52.5)
        self.assertIs(result, self.photo)


class PhotoSerializerGetStacksTestCase(TestCase):
    """``PhotoSerializer.get_stacks`` - the detail-view variant."""

    def setUp(self):
        self.user = create_test_user()
        self.serializer = PhotoSerializer()

    def _stack(self, stack_type=PhotoStack.StackType.MANUAL, primary=None, photos=()):
        stack = PhotoStack.objects.create(
            owner=self.user, stack_type=stack_type, primary_photo=primary
        )
        for photo in photos:
            stack.photos.add(photo)
        return stack

    def test_photo_without_stacks_returns_none(self):
        photo = create_test_photo(owner=self.user)
        self.assertIsNone(self.serializer.get_stacks(photo))

    def test_stack_with_unknown_type_is_filtered_out(self):
        photo = create_test_photo(owner=self.user)
        stack = PhotoStack.objects.create(owner=self.user, stack_type="mystery")
        stack.photos.add(photo)

        self.assertIsNone(self.serializer.get_stacks(photo))

    def test_deprecated_stack_types_are_still_included(self):
        for stack_type in (
            PhotoStack.StackType.RAW_JPEG_PAIR,
            PhotoStack.StackType.LIVE_PHOTO,
        ):
            with self.subTest(stack_type=stack_type):
                photo = create_test_photo(owner=self.user)
                self._stack(stack_type=stack_type, photos=[photo])

                result = self.serializer.get_stacks(photo)
                self.assertEqual(len(result), 1)
                self.assertEqual(result[0]["type"], stack_type)

    def test_primary_photo_shape_and_fields(self):
        primary = create_test_photo(owner=self.user, size=1234)
        other = create_test_photo(owner=self.user, size=99)
        stack = self._stack(primary=primary, photos=[primary, other])

        result = self.serializer.get_stacks(primary)

        self.assertEqual(len(result), 1)
        entry = result[0]
        self.assertEqual(entry["id"], str(stack.id))
        self.assertEqual(entry["type"], PhotoStack.StackType.MANUAL)
        self.assertEqual(entry["type_display"], "Manual Stack")
        self.assertEqual(entry["photo_count"], 2)
        self.assertTrue(entry["is_primary"])
        self.assertEqual(len(entry["photos"]), 2)

        by_hash = {p["image_hash"]: p for p in entry["photos"]}
        self.assertTrue(by_hash[primary.image_hash]["is_primary"])
        self.assertFalse(by_hash[other.image_hash]["is_primary"])
        self.assertEqual(by_hash[primary.image_hash]["id"], str(primary.id))
        self.assertEqual(by_hash[primary.image_hash]["size"], 1234)
        self.assertEqual(
            by_hash[primary.image_hash]["thumbnail_url"],
            f"/media/square_thumbnails_small/{primary.image_hash}",
        )

    def test_non_primary_member_reports_is_primary_false(self):
        primary = create_test_photo(owner=self.user)
        other = create_test_photo(owner=self.user)
        self._stack(primary=primary, photos=[primary, other])

        result = self.serializer.get_stacks(other)
        self.assertFalse(result[0]["is_primary"])

    def test_stack_without_primary_photo_reports_is_primary_false(self):
        photo = create_test_photo(owner=self.user)
        self._stack(primary=None, photos=[photo])

        result = self.serializer.get_stacks(photo)
        self.assertFalse(result[0]["is_primary"])
        self.assertFalse(result[0]["photos"][0]["is_primary"])

    def test_missing_photo_metadata_yields_zero_dimensions(self):
        photo = create_test_photo(owner=self.user)
        self.assertFalse(PhotoMetadata.objects.filter(photo=photo).exists())
        self._stack(photos=[photo])

        entry = self.serializer.get_stacks(photo)[0]["photos"][0]
        self.assertEqual(entry["width"], 0)
        self.assertEqual(entry["height"], 0)

    def test_metadata_dimensions_are_used_when_present(self):
        photo = create_test_photo(owner=self.user, width=800, height=600)
        self._stack(photos=[photo])

        entry = self.serializer.get_stacks(photo)[0]["photos"][0]
        self.assertEqual(entry["width"], 800)
        self.assertEqual(entry["height"], 600)

    def test_null_metadata_dimensions_fall_back_to_zero(self):
        photo = create_test_photo(owner=self.user)
        PhotoMetadata.objects.create(photo=photo, width=None, height=None)
        self._stack(photos=[photo])

        entry = self.serializer.get_stacks(photo)[0]["photos"][0]
        self.assertEqual(entry["width"], 0)
        self.assertEqual(entry["height"], 0)

    def test_missing_square_thumbnail_small_yields_null_thumbnail_url(self):
        photo = create_test_photo(owner=self.user, square_thumbnail_small="")
        self._stack(photos=[photo])

        entry = self.serializer.get_stacks(photo)[0]["photos"][0]
        self.assertIsNone(entry["thumbnail_url"])

    def test_photo_count_counts_stack_members_not_annotations(self):
        photos = [create_test_photo(owner=self.user) for _ in range(3)]
        self._stack(photos=photos)

        result = self.serializer.get_stacks(photos[0])
        self.assertEqual(result[0]["photo_count"], 3)

    def test_photo_in_multiple_stacks_returns_all_of_them(self):
        photo = create_test_photo(owner=self.user)
        other = create_test_photo(owner=self.user)
        s1 = self._stack(
            stack_type=PhotoStack.StackType.MANUAL, primary=photo, photos=[photo, other]
        )
        s2 = self._stack(stack_type=PhotoStack.StackType.BURST_SEQUENCE, photos=[photo])

        result = self.serializer.get_stacks(photo)
        self.assertEqual(len(result), 2)
        self.assertEqual({e["id"] for e in result}, {str(s1.id), str(s2.id)})

    def test_mixed_valid_and_invalid_stacks_returns_only_valid(self):
        photo = create_test_photo(owner=self.user)
        valid = self._stack(
            stack_type=PhotoStack.StackType.EXPOSURE_BRACKET, photos=[photo]
        )
        bogus = PhotoStack.objects.create(owner=self.user, stack_type="mystery")
        bogus.photos.add(photo)

        result = self.serializer.get_stacks(photo)
        self.assertEqual([e["id"] for e in result], [str(valid.id)])

    def test_empty_stack_membership_of_other_photo_is_not_returned(self):
        photo = create_test_photo(owner=self.user)
        other = create_test_photo(owner=self.user)
        self._stack(photos=[other])

        self.assertIsNone(self.serializer.get_stacks(photo))
