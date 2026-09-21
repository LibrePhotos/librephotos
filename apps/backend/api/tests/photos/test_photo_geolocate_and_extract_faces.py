"""Characterization tests for ``Photo._geolocate`` and ``Photo._extract_faces``.

These pin the CURRENT behaviour of the two high-CRAP methods on
``api.models.photo.Photo`` before they are refactored. Everything expensive is
mocked: ``get_metadata`` / ``reverse_geocode`` at the ``api.models.photo``
module level, ``face_extractor`` and ``PIL.Image.open`` likewise. No network,
no exiftool, no ML models.

Quirks deliberately pinned (see inline comments):
  * ``_geolocate`` writes the new coordinates (and saves) BEFORE the geocoder
    runs, so a geocoder failure still leaves the new lat/lon persisted.
  * ``AlbumPlace.geolocation_level`` is only assigned when the photo is not
    already a member of that album place.
  * ``_extract_faces`` swallows ``IntegrityError`` (retrying exactly once) but
    re-raises every other exception.
"""

from unittest.mock import patch

import PIL
from django.db.utils import IntegrityError
from django.test import TestCase, override_settings

from api.models import Face, Person
from api.models.album_place import AlbumPlace, get_album_place
from api.models.cluster import UNKNOWN_CLUSTER_ID
from api.models.photo_search import PhotoSearch
from api.tests.utils import create_test_face, create_test_photo, create_test_user

GEO_RESULT = {
    "_v": "1",
    "places": ["Berlin", "Germany"],
    "features": [
        {"text": "Mitte"},
        {"text": "Berlin"},
        {"text": "Germany"},
    ],
}


def _thumb_image(mode="RGB", size=(200, 200)):
    return PIL.Image.new(mode, size, (10, 20, 30) if mode == "RGB" else None)


class GeolocateCharacterizationTest(TestCase):
    def setUp(self):
        self.user = create_test_user()
        self.photo = create_test_photo(owner=self.user)

    # ---- early returns ------------------------------------------------

    @patch("api.models.photo.reverse_geocode")
    @patch("api.models.photo.get_metadata", return_value=(None, None))
    def test_missing_coordinates_returns_early(self, _meta, reverse_geocode):
        self.photo._geolocate()

        reverse_geocode.assert_not_called()
        self.assertIsNone(self.photo.exif_gps_lat)
        self.assertIsNone(self.photo.geolocation_json)

    @patch("api.models.photo.reverse_geocode")
    @patch("api.models.photo.get_metadata", return_value=(52.5, None))
    def test_missing_longitude_only_returns_early(self, _meta, reverse_geocode):
        self.photo._geolocate()

        reverse_geocode.assert_not_called()
        self.assertIsNone(self.photo.exif_gps_lat)

    @patch("api.models.photo.reverse_geocode")
    @patch("api.models.photo.get_metadata", return_value=(0.0, 0.0))
    def test_null_island_returns_early(self, _meta, reverse_geocode):
        self.photo._geolocate()

        reverse_geocode.assert_not_called()
        self.assertIsNone(self.photo.exif_gps_lon)

    @patch("api.models.photo.reverse_geocode", return_value=GEO_RESULT)
    @patch("api.models.photo.get_metadata", return_value=(52.5, 13.4))
    def test_unchanged_coordinates_with_current_version_short_circuits(
        self, _meta, reverse_geocode
    ):
        """All four conditions met -> nothing is re-geocoded."""
        self.photo.exif_gps_lat = 52.5
        self.photo.exif_gps_lon = 13.4
        self.photo.geolocation_json = {"_v": "1", "features": []}
        self.photo.save()
        get_album_place("Berlin", owner=self.user).photos.add(self.photo)

        self.photo._geolocate()

        reverse_geocode.assert_not_called()

    @patch("api.models.photo.reverse_geocode", return_value=GEO_RESULT)
    @patch("api.models.photo.get_metadata", return_value=(52.5, 13.4))
    def test_stale_geocode_version_is_regeocoded(self, _meta, reverse_geocode):
        self.photo.exif_gps_lat = 52.5
        self.photo.exif_gps_lon = 13.4
        self.photo.geolocation_json = {"_v": "0", "features": []}
        self.photo.save()
        get_album_place("Berlin", owner=self.user).photos.add(self.photo)

        self.photo._geolocate()

        reverse_geocode.assert_called_once_with(52.5, 13.4)

    @patch("api.models.photo.reverse_geocode", return_value=GEO_RESULT)
    @patch("api.models.photo.get_metadata", return_value=(52.5, 13.4))
    def test_same_coordinates_without_album_place_is_regeocoded(
        self, _meta, reverse_geocode
    ):
        """No AlbumPlace membership defeats the short circuit."""
        self.photo.exif_gps_lat = 52.5
        self.photo.exif_gps_lon = 13.4
        self.photo.geolocation_json = {"_v": "1", "features": []}
        self.photo.save()

        self.photo._geolocate()

        reverse_geocode.assert_called_once()

    # ---- happy path ---------------------------------------------------

    @patch("api.models.photo.reverse_geocode", return_value=GEO_RESULT)
    @patch("api.models.photo.get_metadata", return_value=("52.5", "13.4"))
    def test_happy_path_persists_everything(self, _meta, _rev):
        self.photo._geolocate()
        self.photo.refresh_from_db()

        # Strings from the metadata reader are coerced to float.
        self.assertEqual(self.photo.exif_gps_lat, 52.5)
        self.assertEqual(self.photo.exif_gps_lon, 13.4)
        self.assertEqual(self.photo.geolocation_json, GEO_RESULT)

        search = PhotoSearch.objects.get(photo=self.photo)
        self.assertEqual(search.search_location, "Mitte, Berlin, Germany")

        titles = set(
            AlbumPlace.objects.filter(photos=self.photo).values_list("title", flat=True)
        )
        self.assertEqual(titles, {"Mitte", "Berlin", "Germany"})

    @patch("api.models.photo.reverse_geocode", return_value=GEO_RESULT)
    @patch("api.models.photo.get_metadata", return_value=(52.5, 13.4))
    def test_geolocation_level_is_reverse_index_of_feature(self, _meta, _rev):
        self.photo._geolocate()

        levels = {
            ap.title: ap.geolocation_level
            for ap in AlbumPlace.objects.filter(photos=self.photo)
        }
        # len(features) - enumerate index => 3, 2, 1
        self.assertEqual(levels, {"Mitte": 3, "Berlin": 2, "Germany": 1})

    @patch("api.models.photo.reverse_geocode")
    @patch("api.models.photo.get_metadata", return_value=(52.5, 13.4))
    def test_features_without_text_or_numeric_text_are_skipped(self, _meta, rev):
        rev.return_value = {
            "_v": "1",
            "features": [{"id": "no-text"}, {"text": "12345"}, {"text": "Berlin"}],
        }

        self.photo._geolocate()

        titles = set(
            AlbumPlace.objects.filter(photos=self.photo).values_list("title", flat=True)
        )
        self.assertEqual(titles, {"Berlin"})
        # geolocation_level uses the enumerate index, so the surviving third
        # feature gets 3 - 2 == 1.
        self.assertEqual(AlbumPlace.objects.get(title="Berlin").geolocation_level, 1)

    @patch("api.models.photo.reverse_geocode", return_value=GEO_RESULT)
    @patch("api.models.photo.get_metadata", return_value=(52.5, 13.4))
    def test_old_album_places_are_removed(self, _meta, _rev):
        stale = get_album_place("Paris", owner=self.user)
        stale.photos.add(self.photo)

        self.photo._geolocate()

        self.assertFalse(stale.photos.filter(pk=self.photo.pk).exists())
        self.assertTrue(
            AlbumPlace.objects.filter(title="Berlin", photos=self.photo).exists()
        )

    @patch("api.models.photo.reverse_geocode", return_value=GEO_RESULT)
    @patch("api.models.photo.get_metadata", return_value=(52.5, 13.4))
    def test_place_the_photo_already_belonged_to_is_removed_then_readded(
        self, _meta, _rev
    ):
        """A surviving place is first removed as an "old" place, so by the time
        the add loop runs the membership check fails and ``geolocation_level``
        IS assigned. The ``if not ... exists()`` guard therefore only protects
        places added earlier within this same loop.
        """
        existing = get_album_place("Berlin", owner=self.user)
        existing.photos.add(self.photo)

        self.photo._geolocate()

        existing.refresh_from_db()
        self.assertEqual(existing.geolocation_level, 2)
        self.assertTrue(existing.photos.filter(pk=self.photo.pk).exists())

    # ---- geocoder failures --------------------------------------------

    @patch("api.models.photo.reverse_geocode", return_value={})
    @patch("api.models.photo.get_metadata", return_value=(52.5, 13.4))
    def test_empty_geocode_result_returns_after_saving_coordinates(self, _meta, _rev):
        self.photo._geolocate()
        self.photo.refresh_from_db()

        # Coordinates were committed before the geocoder ran.
        self.assertEqual(self.photo.exif_gps_lat, 52.5)
        self.assertIsNone(self.photo.geolocation_json)
        self.assertFalse(PhotoSearch.objects.filter(photo=self.photo).exists())
        self.assertFalse(AlbumPlace.objects.filter(photos=self.photo).exists())

    @patch("api.models.photo.reverse_geocode", side_effect=RuntimeError("boom"))
    @patch("api.models.photo.get_metadata", return_value=(52.5, 13.4))
    def test_geocoder_exception_is_swallowed(self, _meta, _rev):
        self.photo._geolocate()  # must not raise
        self.photo.refresh_from_db()

        self.assertEqual(self.photo.exif_gps_lon, 13.4)
        self.assertIsNone(self.photo.geolocation_json)

    # ---- commit flag ---------------------------------------------------

    @patch("api.models.photo.reverse_geocode", return_value=GEO_RESULT)
    @patch("api.models.photo.get_metadata", return_value=(52.5, 13.4))
    def test_commit_false_leaves_database_row_untouched(self, _meta, _rev):
        self.photo._geolocate(commit=False)

        # In-memory instance is updated ...
        self.assertEqual(self.photo.exif_gps_lat, 52.5)
        self.assertEqual(self.photo.geolocation_json, GEO_RESULT)
        # ... but the row is not, even though AlbumPlace/PhotoSearch side
        # effects still happen unconditionally.
        fresh = type(self.photo).objects.get(pk=self.photo.pk)
        self.assertIsNone(fresh.exif_gps_lat)
        self.assertIsNone(fresh.geolocation_json)
        self.assertTrue(AlbumPlace.objects.filter(photos=self.photo).exists())
        self.assertTrue(PhotoSearch.objects.filter(photo=self.photo).exists())

    @patch("api.models.photo.reverse_geocode", return_value=GEO_RESULT)
    @patch("api.models.photo.get_metadata", return_value=(52.5, 13.4))
    def test_metadata_is_read_from_main_file_with_sidecar(self, get_metadata, _rev):
        self.photo._geolocate()

        args, kwargs = get_metadata.call_args
        self.assertEqual(args[0], self.photo.main_file.path)
        self.assertTrue(kwargs["try_sidecar"])
        self.assertEqual(len(kwargs["tags"]), 2)

    @patch("api.models.photo.reverse_geocode", return_value=GEO_RESULT)
    @patch("api.models.photo.get_metadata", return_value=(52.5, 13.4))
    def test_existing_photo_search_row_is_reused(self, _meta, _rev):
        PhotoSearch.objects.create(photo=self.photo, search_location="stale")

        self.photo._geolocate()

        self.assertEqual(PhotoSearch.objects.filter(photo=self.photo).count(), 1)
        self.assertEqual(
            PhotoSearch.objects.get(photo=self.photo).search_location,
            "Mitte, Berlin, Germany",
        )


class ExtractFacesCharacterizationTest(TestCase):
    def setUp(self):
        self.user = create_test_user()
        self.photo = create_test_photo(owner=self.user)

    # ---- feature flag / empty results ---------------------------------

    @override_settings(FEATURE_FACE_DETECTION=False)
    @patch("api.models.photo.PIL.Image.open")
    @patch("api.models.photo.face_extractor")
    def test_disabled_feature_flag_returns_immediately(self, extractor, image_open):
        self.photo._extract_faces()

        extractor.extract.assert_not_called()
        image_open.assert_not_called()
        self.assertEqual(Face.objects.filter(photo=self.photo).count(), 0)

    @patch("api.models.photo.PIL.Image.open", return_value=_thumb_image())
    @patch("api.models.photo.face_extractor")
    def test_no_faces_found_creates_nothing(self, extractor, _open):
        extractor.extract.return_value = []

        self.photo._extract_faces()

        self.assertEqual(Face.objects.filter(photo=self.photo).count(), 0)
        extractor.extract.assert_called_once_with(
            self.photo.main_file.path,
            self.photo.thumbnail.thumbnail_big.path,
            self.user,
        )

    # ---- creating faces ------------------------------------------------

    @patch("api.models.photo.PIL.Image.open", return_value=_thumb_image())
    @patch("api.models.photo.face_extractor")
    def test_unnamed_face_is_created_without_person(self, extractor, _open):
        extractor.extract.return_value = [(10, 60, 50, 20, None)]

        self.photo._extract_faces()

        face = Face.objects.get(photo=self.photo)
        self.assertEqual(
            (
                face.location_top,
                face.location_right,
                face.location_bottom,
                face.location_left,
            ),
            (10, 60, 50, 20),
        )
        self.assertIsNone(face.person)
        self.assertEqual(face.encoding, "")
        self.assertEqual(face.cluster.cluster_id, UNKNOWN_CLUSTER_ID)
        self.assertIn(self.photo.image_hash + "_0.jpg", face.image.name)
        self.assertEqual(Person.objects.filter(cluster_owner=self.user).count(), 0)

    @patch("api.models.photo.PIL.Image.open", return_value=_thumb_image())
    @patch("api.models.photo.face_extractor")
    def test_named_face_creates_user_labelled_person(self, extractor, _open):
        extractor.extract.return_value = [(10, 60, 50, 20, "Ada Lovelace")]

        self.photo._extract_faces()

        face = Face.objects.get(photo=self.photo)
        self.assertIsNotNone(face.person)
        self.assertEqual(face.person.name, "Ada Lovelace")
        self.assertEqual(face.person.kind, Person.KIND_USER)
        face.person.refresh_from_db()
        self.assertEqual(face.person.face_count, 1)

    @patch("api.models.photo.PIL.Image.open", return_value=_thumb_image())
    @patch("api.models.photo.face_extractor")
    def test_multiple_non_overlapping_faces_get_indexed_image_names(
        self, extractor, _open
    ):
        extractor.extract.return_value = [
            (0, 40, 40, 0, None),
            (100, 150, 150, 100, None),
        ]

        self.photo._extract_faces()

        names = sorted(f.image.name for f in Face.objects.filter(photo=self.photo))
        self.assertEqual(len(names), 2)
        self.assertTrue(any("_0.jpg" in n for n in names))
        self.assertTrue(any("_1.jpg" in n for n in names))

    @patch("api.models.photo.PIL.Image.open", return_value=_thumb_image("RGBA"))
    @patch("api.models.photo.face_extractor")
    def test_rgba_thumbnail_is_converted_before_jpeg_save(self, extractor, _open):
        extractor.extract.return_value = [(10, 60, 50, 20, None)]

        self.photo._extract_faces()

        self.assertEqual(Face.objects.filter(photo=self.photo).count(), 1)

    # ---- overlap handling ----------------------------------------------

    @patch("api.models.photo.PIL.Image.open", return_value=_thumb_image())
    @patch("api.models.photo.face_extractor")
    def test_overlapping_unnamed_face_is_skipped(self, extractor, _open):
        create_test_face(
            photo=self.photo,
            location_top=10,
            location_right=60,
            location_bottom=50,
            location_left=20,
        )
        extractor.extract.return_value = [(11, 61, 51, 21, None)]

        self.photo._extract_faces()

        self.assertEqual(Face.objects.filter(photo=self.photo).count(), 1)

    @patch("api.models.photo.PIL.Image.open", return_value=_thumb_image())
    @patch("api.models.photo.face_extractor")
    def test_duplicate_locations_in_one_batch_are_deduplicated(self, extractor, _open):
        extractor.extract.return_value = [
            (10, 60, 50, 20, None),
            (10, 60, 50, 20, None),
        ]

        self.photo._extract_faces()

        # The freshly created face is appended to the in-memory overlap list.
        self.assertEqual(Face.objects.filter(photo=self.photo).count(), 1)

    @patch("api.models.photo.PIL.Image.open", return_value=_thumb_image())
    @patch("api.models.photo.face_extractor")
    def test_xmp_name_is_reconciled_onto_existing_unassigned_face(
        self, extractor, _open
    ):
        existing = create_test_face(
            photo=self.photo,
            person=None,
            location_top=10,
            location_right=60,
            location_bottom=50,
            location_left=20,
        )
        extractor.extract.return_value = [(11, 61, 51, 21, "Ada Lovelace")]

        self.photo._extract_faces()

        self.assertEqual(Face.objects.filter(photo=self.photo).count(), 1)
        existing.refresh_from_db()
        self.assertIsNotNone(existing.person)
        self.assertEqual(existing.person.name, "Ada Lovelace")
        existing.person.refresh_from_db()
        self.assertEqual(existing.person.face_count, 1)

    @patch("api.models.photo.PIL.Image.open", return_value=_thumb_image())
    @patch("api.models.photo.face_extractor")
    def test_existing_face_with_person_is_not_reassigned(self, extractor, _open):
        keeper = Person.objects.create(name="Grace Hopper", kind=Person.KIND_USER)
        existing = create_test_face(
            photo=self.photo,
            person=keeper,
            location_top=10,
            location_right=60,
            location_bottom=50,
            location_left=20,
        )
        extractor.extract.return_value = [(11, 61, 51, 21, "Ada Lovelace")]

        self.photo._extract_faces()

        existing.refresh_from_db()
        self.assertEqual(existing.person_id, keeper.id)
        self.assertEqual(Face.objects.filter(photo=self.photo).count(), 1)
        # The Person row for the XMP name is still created up front.
        self.assertTrue(Person.objects.filter(name="Ada Lovelace").exists())

    # ---- error handling -------------------------------------------------

    @patch("api.models.photo.PIL.Image.open", return_value=_thumb_image())
    @patch("api.models.photo.face_extractor")
    def test_integrity_error_triggers_exactly_one_retry(self, extractor, _open):
        extractor.extract.side_effect = [IntegrityError("dup"), []]

        self.photo._extract_faces()  # must not raise

        self.assertEqual(extractor.extract.call_count, 2)

    @patch("api.models.photo.PIL.Image.open", return_value=_thumb_image())
    @patch("api.models.photo.face_extractor")
    def test_integrity_error_on_retry_is_swallowed(self, extractor, _open):
        extractor.extract.side_effect = IntegrityError("dup")

        self.photo._extract_faces()  # must not raise

        self.assertEqual(extractor.extract.call_count, 2)
        self.assertEqual(Face.objects.filter(photo=self.photo).count(), 0)

    @patch("api.models.photo.PIL.Image.open", return_value=_thumb_image())
    @patch("api.models.photo.face_extractor")
    def test_non_integrity_exception_is_reraised(self, extractor, _open):
        extractor.extract.side_effect = ValueError("nope")

        with self.assertRaises(ValueError):
            self.photo._extract_faces()

        self.assertEqual(extractor.extract.call_count, 1)

    @patch("api.models.photo.PIL.Image.open", side_effect=FileNotFoundError("no thumb"))
    @patch("api.models.photo.face_extractor")
    def test_missing_thumbnail_propagates(self, extractor, _open):
        with self.assertRaises(FileNotFoundError):
            self.photo._extract_faces()

        extractor.extract.assert_not_called()

    @patch("api.models.photo.PIL.Image.open", return_value=_thumb_image())
    @patch("api.models.photo.face_extractor")
    def test_unknown_cluster_is_created_for_owner(self, extractor, _open):
        extractor.extract.return_value = []

        self.photo._extract_faces()

        from api.models.cluster import Cluster

        self.assertTrue(
            Cluster.objects.filter(
                owner=self.user, cluster_id=UNKNOWN_CLUSTER_ID
            ).exists()
        )
