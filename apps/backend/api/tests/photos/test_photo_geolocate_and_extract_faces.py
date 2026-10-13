"""Characterization tests for ``geolocate_photo`` and ``extract_faces``.

These pin the behaviour of the two high-CRAP functions, which used to be
``Photo._geolocate`` and ``Photo._extract_faces``. Everything expensive is
mocked: ``reverse_geocode`` at the ``api.geocode.photo_location`` module
level, ``face_extractor`` and
``PIL.Image.open`` at ``api.faces.photo_faces``. No network, no exiftool, no ML
models.

Quirks deliberately pinned (see inline comments):
  * ``geolocate_photo`` looks up the stored position; a failed lookup leaves
    it ungeocoded, so the next geolocation job tries again.
  * ``AlbumPlace.geolocation_level`` is only assigned when the photo is not
    already a member of that album place.
  * ``extract_faces`` swallows ``IntegrityError`` (retrying exactly once) but
    re-raises every other exception.
"""

from unittest.mock import patch

import PIL.Image
from django.db.utils import IntegrityError
from django.test import TestCase, override_settings

from api.faces.photo_faces import extract_faces
from api.geocode.photo_location import geolocate_photo, needs_geocoding
from api.metadata.reader import sidecar_files_for_photo
from api.models import Face, Person, Photo
from api.models.album_place import AlbumPlace, get_album_place
from api.models.cluster import UNKNOWN_CLUSTER_ID
from api.models.photo_search import PhotoSearch
from api.tests.utils import (
    create_test_face,
    create_test_person,
    create_test_photo,
    create_test_user,
)

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


GEOCODER = "api.geocode.photo_location.reverse_geocode"


class GeolocateCharacterizationTest(TestCase):
    """``geolocate_photo`` looks up the place of the photo's stored position.

    The position itself comes from the scan (``apply_file_position``) or the
    user; ``geocoded_lat/lon`` record which position the place is for (#2264).
    """

    def setUp(self):
        self.user = create_test_user()
        self.photo = create_test_photo(owner=self.user)
        self.at(52.5, 13.4)

    def at(self, lat, lon):
        Photo.objects.filter(pk=self.photo.pk).update(
            exif_gps_lat=lat, exif_gps_lon=lon
        )
        self.photo.refresh_from_db()

    # ---- early returns ------------------------------------------------

    @patch(GEOCODER)
    def test_missing_coordinates_returns_early(self, reverse_geocode):
        self.at(None, None)

        geolocate_photo(self.photo)

        reverse_geocode.assert_not_called()
        self.assertIsNone(self.photo.geolocation_json)

    @patch(GEOCODER)
    def test_missing_longitude_only_returns_early(self, reverse_geocode):
        self.at(52.5, None)

        geolocate_photo(self.photo)

        reverse_geocode.assert_not_called()

    @patch(GEOCODER)
    def test_null_island_returns_early(self, reverse_geocode):
        self.at(0.0, 0.0)

        geolocate_photo(self.photo)

        reverse_geocode.assert_not_called()

    @patch(GEOCODER, return_value=GEO_RESULT)
    def test_a_current_place_for_this_position_short_circuits(self, reverse_geocode):
        self._place_in_berlin()

        geolocate_photo(self.photo)

        reverse_geocode.assert_not_called()

    @patch(GEOCODER, return_value=GEO_RESULT)
    def test_stale_geocode_version_is_regeocoded(self, reverse_geocode):
        self._place_in_berlin(version="0")

        geolocate_photo(self.photo)

        reverse_geocode.assert_called_once_with(52.5, 13.4)

    @patch(GEOCODER, return_value=GEO_RESULT)
    def test_same_position_without_album_place_is_regeocoded(self, reverse_geocode):
        """No AlbumPlace membership defeats the short circuit."""
        self._place_in_berlin()
        AlbumPlace.objects.get(title="Berlin").photos.remove(self.photo)

        geolocate_photo(self.photo)

        reverse_geocode.assert_called_once()

    @patch(GEOCODER, return_value=GEO_RESULT)
    def test_a_position_that_moved_since_its_lookup_is_regeocoded(
        self, reverse_geocode
    ):
        # A scan read new GPS from the file (#2264).
        self._place_in_berlin()
        self.at(48.85, 2.35)

        geolocate_photo(self.photo)

        reverse_geocode.assert_called_once_with(48.85, 2.35)
        self.photo.refresh_from_db()
        self.assertEqual(
            (48.85, 2.35), (self.photo.geocoded_lat, self.photo.geocoded_lon)
        )

    # ---- happy path ---------------------------------------------------

    @patch(GEOCODER, return_value=GEO_RESULT)
    def test_happy_path_persists_everything(self, _rev):
        geolocate_photo(self.photo)
        self.photo.refresh_from_db()

        self.assertEqual(
            (52.5, 13.4), (self.photo.exif_gps_lat, self.photo.exif_gps_lon)
        )
        self.assertEqual(
            (52.5, 13.4), (self.photo.geocoded_lat, self.photo.geocoded_lon)
        )
        self.assertEqual(self.photo.geolocation_json, GEO_RESULT)

        search = PhotoSearch.objects.get(photo=self.photo)
        self.assertEqual(search.search_location, "Mitte, Berlin, Germany")

        titles = set(
            AlbumPlace.objects.filter(photos=self.photo).values_list("title", flat=True)
        )
        self.assertEqual(titles, {"Mitte", "Berlin", "Germany"})

    @patch(GEOCODER, return_value=GEO_RESULT)
    def test_geolocation_level_is_reverse_index_of_feature(self, _rev):
        geolocate_photo(self.photo)

        levels = {
            ap.title: ap.geolocation_level
            for ap in AlbumPlace.objects.filter(photos=self.photo)
        }
        # len(features) - enumerate index => 3, 2, 1
        self.assertEqual(levels, {"Mitte": 3, "Berlin": 2, "Germany": 1})

    @patch(GEOCODER)
    def test_features_without_text_or_numeric_text_are_skipped(self, rev):
        rev.return_value = {
            "_v": "1",
            "features": [{"id": "no-text"}, {"text": "12345"}, {"text": "Berlin"}],
        }

        geolocate_photo(self.photo)

        titles = set(
            AlbumPlace.objects.filter(photos=self.photo).values_list("title", flat=True)
        )
        self.assertEqual(titles, {"Berlin"})
        # geolocation_level uses the enumerate index, so the surviving third
        # feature gets 3 - 2 == 1.
        self.assertEqual(AlbumPlace.objects.get(title="Berlin").geolocation_level, 1)

    @patch(GEOCODER, return_value=GEO_RESULT)
    def test_old_album_places_are_removed(self, _rev):
        stale = get_album_place("Paris", owner=self.user)
        stale.photos.add(self.photo)

        geolocate_photo(self.photo)

        self.assertFalse(stale.photos.filter(pk=self.photo.pk).exists())
        self.assertTrue(
            AlbumPlace.objects.filter(title="Berlin", photos=self.photo).exists()
        )

    @patch(GEOCODER, return_value=GEO_RESULT)
    def test_place_the_photo_already_belonged_to_is_removed_then_readded(self, _rev):
        """A surviving place is first removed as an "old" place, so by the time
        the add loop runs the membership check fails and ``geolocation_level``
        IS assigned. The ``if not ... exists()`` guard therefore only protects
        places added earlier within this same loop.
        """
        existing = get_album_place("Berlin", owner=self.user)
        existing.photos.add(self.photo)

        geolocate_photo(self.photo)

        existing.refresh_from_db()
        self.assertEqual(existing.geolocation_level, 2)
        self.assertTrue(existing.photos.filter(pk=self.photo.pk).exists())

    # ---- geocoder failures --------------------------------------------

    @patch(GEOCODER, return_value={})
    def test_empty_geocode_result_leaves_the_position_to_retry(self, _rev):
        geolocate_photo(self.photo)
        self.photo.refresh_from_db()

        self.assertEqual(self.photo.exif_gps_lat, 52.5)
        # Not geocoded: the next geolocation job tries again.
        self.assertIsNone(self.photo.geocoded_lat)
        self.assertFalse(AlbumPlace.objects.filter(photos=self.photo).exists())

    @patch(GEOCODER, side_effect=RuntimeError("boom"))
    def test_geocoder_exception_is_swallowed(self, _rev):
        geolocate_photo(self.photo)  # must not raise
        self.photo.refresh_from_db()

        self.assertEqual(self.photo.exif_gps_lon, 13.4)
        self.assertIsNone(self.photo.geocoded_lon)

    @patch(GEOCODER, return_value={})
    def test_moved_coordinates_without_a_result_forget_the_old_place(self, _rev):
        # #2253: the position changed and the geocoder failed; the photo
        # kept the address, search text and Places albums of its old fix.
        self._place_in_berlin()
        self.at(48.85, 2.35)

        geolocate_photo(self.photo)
        self.photo.refresh_from_db()

        self.assertEqual(self.photo.exif_gps_lat, 48.85)
        self.assertEqual(self.photo.geolocation_json, {})
        self.assertEqual(
            (None, None), (self.photo.geocoded_lat, self.photo.geocoded_lon)
        )
        self.assertEqual(PhotoSearch.objects.get(photo=self.photo).search_location, "")
        self.assertFalse(AlbumPlace.objects.filter(photos=self.photo).exists())

    @patch(GEOCODER, return_value={})
    def test_same_coordinates_without_a_result_keep_their_place(self, _rev):
        # A stale geocode version is retried; failing that, the place of the
        # unchanged coordinates still applies.
        self._place_in_berlin(version="0")

        geolocate_photo(self.photo)
        self.photo.refresh_from_db()

        self.assertEqual(self.photo.geolocation_json["places"], ["Berlin", "Germany"])
        self.assertTrue(
            AlbumPlace.objects.filter(title="Berlin", photos=self.photo).exists()
        )

    def _place_in_berlin(self, version="1"):
        Photo.objects.filter(pk=self.photo.pk).update(
            exif_gps_lat=52.5,
            exif_gps_lon=13.4,
            geocoded_lat=52.5,
            geocoded_lon=13.4,
            geolocation_json={**GEO_RESULT, "_v": version},
        )
        self.photo.refresh_from_db()
        get_album_place("Berlin", owner=self.user).photos.add(self.photo)
        PhotoSearch.objects.update_or_create(
            photo=self.photo, defaults={"search_location": "Berlin, Germany"}
        )

    # ---- concurrent writers ---------------------------------------------
    #
    # The geolocation job holds a row loaded before the geocoder's network
    # call, while Probe Videos fills in the same photos' video fields and a
    # scan may read new GPS from the file.

    def _changed_meanwhile(self):
        held_by_job = Photo.objects.get(pk=self.photo.pk)
        Photo.objects.filter(pk=self.photo.pk).update(
            video_color_transfer="smpte2084",
            video_pixel_format="yuv420p10le",
            exif_gps_lat=48.85,
            exif_gps_lon=2.35,
        )
        return held_by_job

    @patch(GEOCODER, return_value=GEO_RESULT)
    def test_columns_changed_while_the_job_held_the_row_are_kept(self, _rev):
        geolocate_photo(self._changed_meanwhile())
        self.photo.refresh_from_db()

        self.assertEqual(self.photo.video_color_transfer, "smpte2084")
        self.assertEqual(self.photo.video_pixel_format, "yuv420p10le")
        self.assertEqual(self.photo.geolocation_json, GEO_RESULT)
        # The place is for the old position, so the new one is looked up next.
        self.assertEqual(
            (48.85, 2.35), (self.photo.exif_gps_lat, self.photo.exif_gps_lon)
        )
        self.assertEqual(
            (52.5, 13.4), (self.photo.geocoded_lat, self.photo.geocoded_lon)
        )
        self.assertTrue(
            Photo.objects.filter(pk=self.photo.pk).filter(needs_geocoding()).exists()
        )

    @patch(GEOCODER, return_value=GEO_RESULT)
    def test_geolocating_still_tells_the_sync_feed(self, _rev):
        before = Photo.objects.get(pk=self.photo.pk).last_modified

        geolocate_photo(Photo.objects.get(pk=self.photo.pk))

        self.assertGreater(Photo.objects.get(pk=self.photo.pk).last_modified, before)

    # ---- commit flag ---------------------------------------------------

    @patch(GEOCODER, return_value=GEO_RESULT)
    def test_commit_false_leaves_database_row_untouched(self, _rev):
        geolocate_photo(self.photo, commit=False)

        # In-memory instance is updated ...
        self.assertEqual(self.photo.geocoded_lat, 52.5)
        self.assertEqual(self.photo.geolocation_json, GEO_RESULT)
        # ... but the row is not, even though AlbumPlace/PhotoSearch side
        # effects still happen unconditionally.
        fresh = type(self.photo).objects.get(pk=self.photo.pk)
        self.assertIsNone(fresh.geocoded_lat)
        self.assertIsNone(fresh.geolocation_json)
        self.assertTrue(AlbumPlace.objects.filter(photos=self.photo).exists())
        self.assertTrue(PhotoSearch.objects.filter(photo=self.photo).exists())

    @patch(GEOCODER, return_value=GEO_RESULT)
    def test_existing_photo_search_row_is_reused(self, _rev):
        PhotoSearch.objects.create(photo=self.photo, search_location="stale")

        geolocate_photo(self.photo)

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
    @patch("api.faces.photo_faces.PIL.Image.open")
    @patch("api.faces.photo_faces.extractor")
    def test_disabled_feature_flag_returns_immediately(self, extractor, image_open):
        extract_faces(self.photo)

        extractor.extract_from_exif.assert_not_called()
        extractor.extract_from_face_service.assert_not_called()
        image_open.assert_not_called()
        self.assertEqual(Face.objects.filter(photo=self.photo).count(), 0)

    @patch("api.faces.photo_faces.PIL.Image.open", return_value=_thumb_image())
    @patch("api.faces.photo_faces.extractor")
    def test_no_faces_found_creates_nothing(self, extractor, _open):
        extractor.extract_from_exif.return_value = None
        extractor.extract_from_face_service.return_value = []

        extract_faces(self.photo)

        self.assertEqual(Face.objects.filter(photo=self.photo).count(), 0)
        extractor.extract_from_exif.assert_called_once_with(
            self.photo.main_file.path,
            self.photo.thumbnail.thumbnail_big.path,
            sidecar_files_for_photo(self.photo),
            local_orientation=self.photo.local_orientation,
        )
        extractor.extract_from_face_service.assert_called_once_with(
            self.photo.thumbnail.thumbnail_big.path
        )

    # ---- creating faces ------------------------------------------------

    @patch("api.faces.photo_faces.PIL.Image.open", return_value=_thumb_image())
    @patch("api.faces.photo_faces.extractor")
    def test_unnamed_face_is_created_without_person(self, extractor, _open):
        extractor.extract_from_face_service.return_value = [(10, 60, 50, 20, None)]

        extract_faces(self.photo)

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

    @patch("api.faces.photo_faces.PIL.Image.open", return_value=_thumb_image())
    @patch("api.faces.photo_faces.extractor")
    def test_encoding_from_the_face_service_is_stored_with_the_face(
        self, extractor, _open
    ):
        import numpy as np

        encoding = np.array([0.5, -1.25, 3.0])
        extractor.extract_from_face_service.return_value = [
            (10, 60, 50, 20, None, encoding)
        ]

        extract_faces(self.photo)

        face = Face.objects.get(photo=self.photo)
        # Stored as generate_face_encoding stores it, so nothing is left for
        # generate_face_embeddings to ask the face service for again.
        self.assertEqual(face.encoding, encoding.tobytes().hex())
        # Read back at unit length, which clustering compares (#1996).
        np.testing.assert_allclose(
            face.get_encoding_array(), encoding / np.linalg.norm(encoding)
        )

    @patch("api.faces.photo_faces.PIL.Image.open", return_value=_thumb_image())
    @patch("api.faces.photo_faces.extractor")
    def test_named_face_creates_user_labelled_person(self, extractor, _open):
        extractor.extract_from_exif.return_value = [(10, 60, 50, 20, "Ada Lovelace")]

        extract_faces(self.photo)

        face = Face.objects.get(photo=self.photo)
        self.assertIsNotNone(face.person)
        self.assertEqual(face.person.name, "Ada Lovelace")
        self.assertEqual(face.person.kind, Person.KIND_USER)
        face.person.refresh_from_db()
        self.assertEqual(face.person.face_count, 1)

    @patch("api.faces.photo_faces.PIL.Image.open", return_value=_thumb_image())
    @patch("api.faces.photo_faces.extractor")
    def test_multiple_non_overlapping_faces_get_indexed_image_names(
        self, extractor, _open
    ):
        extractor.extract_from_face_service.return_value = [
            (0, 40, 40, 0, None),
            (100, 150, 150, 100, None),
        ]

        extract_faces(self.photo)

        names = sorted(f.image.name for f in Face.objects.filter(photo=self.photo))
        self.assertEqual(len(names), 2)
        self.assertTrue(any("_0.jpg" in n for n in names))
        self.assertTrue(any("_1.jpg" in n for n in names))

    @patch("api.faces.photo_faces.PIL.Image.open", return_value=_thumb_image("RGBA"))
    @patch("api.faces.photo_faces.extractor")
    def test_rgba_thumbnail_is_converted_before_jpeg_save(self, extractor, _open):
        extractor.extract_from_face_service.return_value = [(10, 60, 50, 20, None)]

        extract_faces(self.photo)

        self.assertEqual(Face.objects.filter(photo=self.photo).count(), 1)

    # ---- overlap handling ----------------------------------------------

    @patch("api.faces.photo_faces.PIL.Image.open", return_value=_thumb_image())
    @patch("api.faces.photo_faces.extractor")
    def test_overlapping_unnamed_face_is_skipped(self, extractor, _open):
        create_test_face(
            photo=self.photo,
            location_top=10,
            location_right=60,
            location_bottom=50,
            location_left=20,
        )
        extractor.extract_from_face_service.return_value = [(11, 61, 51, 21, None)]

        extract_faces(self.photo)

        self.assertEqual(Face.objects.filter(photo=self.photo).count(), 1)

    @patch("api.faces.photo_faces.PIL.Image.open", return_value=_thumb_image())
    @patch("api.faces.photo_faces.extractor")
    def test_duplicate_locations_in_one_batch_are_deduplicated(self, extractor, _open):
        extractor.extract_from_face_service.return_value = [
            (10, 60, 50, 20, None),
            (10, 60, 50, 20, None),
        ]

        extract_faces(self.photo)

        # The freshly created face is appended to the in-memory overlap list.
        self.assertEqual(Face.objects.filter(photo=self.photo).count(), 1)

    @patch("api.faces.photo_faces.PIL.Image.open", return_value=_thumb_image())
    @patch("api.faces.photo_faces.extractor")
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
        extractor.extract_from_exif.return_value = [(11, 61, 51, 21, "Ada Lovelace")]

        extract_faces(self.photo)

        self.assertEqual(Face.objects.filter(photo=self.photo).count(), 1)
        existing.refresh_from_db()
        self.assertIsNotNone(existing.person)
        self.assertEqual(existing.person.name, "Ada Lovelace")
        existing.person.refresh_from_db()
        self.assertEqual(existing.person.face_count, 1)

    @patch("api.faces.photo_faces.PIL.Image.open", return_value=_thumb_image())
    @patch("api.faces.photo_faces.extractor")
    def test_existing_face_with_person_is_not_reassigned(self, extractor, _open):
        keeper = create_test_person(name="Grace Hopper", kind=Person.KIND_USER)
        existing = create_test_face(
            photo=self.photo,
            person=keeper,
            location_top=10,
            location_right=60,
            location_bottom=50,
            location_left=20,
        )
        extractor.extract_from_exif.return_value = [(11, 61, 51, 21, "Ada Lovelace")]

        extract_faces(self.photo)

        existing.refresh_from_db()
        self.assertEqual(existing.person_id, keeper.id)
        self.assertEqual(Face.objects.filter(photo=self.photo).count(), 1)
        # The Person row for the XMP name is still created up front.
        self.assertTrue(Person.objects.filter(name="Ada Lovelace").exists())

    # ---- error handling -------------------------------------------------

    @patch("api.faces.photo_faces.PIL.Image.open", return_value=_thumb_image())
    @patch("api.faces.photo_faces.extractor")
    def test_integrity_error_triggers_exactly_one_retry(self, extractor, _open):
        extractor.extract_from_face_service.side_effect = [IntegrityError("dup"), []]

        extract_faces(self.photo)  # must not raise

        self.assertEqual(extractor.extract_from_face_service.call_count, 2)

    @patch("api.faces.photo_faces.PIL.Image.open", return_value=_thumb_image())
    @patch("api.faces.photo_faces.extractor")
    def test_integrity_error_on_retry_is_swallowed(self, extractor, _open):
        extractor.extract_from_face_service.side_effect = IntegrityError("dup")

        extract_faces(self.photo)  # must not raise

        self.assertEqual(extractor.extract_from_face_service.call_count, 2)
        self.assertEqual(Face.objects.filter(photo=self.photo).count(), 0)

    @patch("api.faces.photo_faces.PIL.Image.open", return_value=_thumb_image())
    @patch("api.faces.photo_faces.extractor")
    def test_non_integrity_exception_is_reraised(self, extractor, _open):
        extractor.extract_from_face_service.side_effect = ValueError("nope")

        with self.assertRaises(ValueError):
            extract_faces(self.photo)

        self.assertEqual(extractor.extract_from_face_service.call_count, 1)

    @patch(
        "api.faces.photo_faces.PIL.Image.open",
        side_effect=FileNotFoundError("no thumb"),
    )
    @patch("api.faces.photo_faces.extractor")
    def test_missing_thumbnail_propagates(self, extractor, _open):
        with self.assertRaises(FileNotFoundError):
            extract_faces(self.photo)

        extractor.extract_from_exif.assert_not_called()
        extractor.extract_from_face_service.assert_not_called()

    @patch("api.faces.photo_faces.PIL.Image.open", return_value=_thumb_image())
    @patch("api.faces.photo_faces.extractor")
    def test_unknown_cluster_is_created_for_owner(self, extractor, _open):
        extractor.extract_from_face_service.return_value = []

        extract_faces(self.photo)

        from api.models.cluster import Cluster

        self.assertTrue(
            Cluster.objects.filter(
                owner=self.user, cluster_id=UNKNOWN_CLUSTER_ID
            ).exists()
        )
