"""GPS edited in a file LibrePhotos already knows reaches the photo (#2264).

Another program geotags a scanned photo, corrects its position or strips it
(``exiftool -gps:all=`` before sharing a folder). The next scan reads the file
again; the position it finds replaces the stored one, or clears it with its
place, unless the user set the position in LibrePhotos. The geolocation job
then looks up the place of every position that changed, whenever the photo
was added.

These run the scan's metadata step against real ExifTool; the geocoder is
mocked.
"""

import datetime
import uuid
from datetime import timedelta
from unittest.mock import patch

from django.utils import timezone

from api.directory_watcher import processing_jobs
from api.directory_watcher.file_handlers import _read_metadata
from api.geocode.photo_location import geolocate_photo
from api.metadata import edits
from api.models import LongRunningJob
from api.models.album_place import AlbumPlace
from api.models.photo import Photo
from api.models.photo_search import PhotoSearch
from api.tests.metadata.exiftool_harness import RealExifToolTestCase
from api.tests.utils import create_test_user

BERLIN = (52.52, 13.405)
PARIS = (48.8566, 2.3522)
LISBON = (38.7223, -9.1393)


def place(name: str, country: str) -> dict[str, object]:
    return {
        "_v": "1",
        "places": [name, country],
        "address": f"{name}, {country}",
        "features": [{"text": name}, {"text": country}],
    }


PLACES = {BERLIN: place("Berlin", "Germany"), PARIS: place("Paris", "France")}


def fake_geocoder(lat: float, lon: float) -> dict[str, object]:
    return dict(PLACES.get((lat, lon), {}))


class ScanUpdatesGpsTest(RealExifToolTestCase):
    def setUp(self) -> None:
        super().setUp()
        self.user = create_test_user()
        self.image = self.make_image(name="geotagged")
        self.tag_position(*BERLIN)

    def tag_position(self, lat: float, lon: float) -> None:
        self.tag(
            self.image,
            f"-GPSLatitude={abs(lat)}",
            f"-GPSLatitudeRef={'S' if lat < 0 else 'N'}",
            f"-GPSLongitude={abs(lon)}",
            f"-GPSLongitudeRef={'W' if lon < 0 else 'E'}",
        )

    def strip_position(self) -> None:
        self.tag(self.image, "-gps:all=")

    def scan(self, photo: Photo) -> Photo:
        """The scan's metadata step (EXIF, category, date), as ``_process_photo`` runs it."""
        assert photo.main_file is not None
        _read_metadata(
            photo, photo.main_file.path, str(uuid.uuid4()), datetime.datetime.now()
        )
        return self.reload(photo)

    def reload(self, photo: Photo) -> Photo:
        return Photo.objects.select_related("main_file", "owner").get(pk=photo.pk)

    def geolocate(self, photo: Photo) -> Photo:
        with patch(
            "api.geocode.photo_location.reverse_geocode", side_effect=fake_geocoder
        ):
            geolocate_photo(photo)
        return self.reload(photo)

    def scanned_and_placed(self) -> Photo:
        """A photo scanned and geocoded in Berlin, as the scan and the job leave it."""
        photo = self.geolocate(self.scan(self.photo_for(self.image, self.user)))
        self.assertEqual("Berlin", self.places_of(photo)[0])
        return photo

    def places_of(self, photo: Photo) -> list[str]:
        return sorted(
            AlbumPlace.objects.filter(photos=photo).values_list("title", flat=True)
        )

    def search_location(self, photo: Photo) -> str:
        return PhotoSearch.objects.get(photo=photo).search_location or ""

    def position(self, photo: Photo) -> tuple[float | None, float | None]:
        return (photo.exif_gps_lat, photo.exif_gps_lon)

    # ---- GPS removed from the file ------------------------------------

    def test_gps_stripped_from_the_file_clears_the_position_and_place(self) -> None:
        photo = self.scanned_and_placed()

        self.strip_position()
        photo = self.scan(photo)

        self.assertEqual((None, None), self.position(photo))
        self.assertIsNone(photo.geolocation_json)
        self.assertEqual([], self.places_of(photo))
        self.assertEqual("", self.search_location(photo))

    def test_gps_stripped_keeps_a_position_the_user_set(self) -> None:
        photo = self.scanned_and_placed()
        with patch("api.metadata.edits.reverse_geocode", side_effect=fake_geocoder):
            edits.set_location(photo, *PARIS, self.user)

        self.strip_position()
        photo = self.scan(photo)

        self.assertEqual(PARIS, self.position(photo))
        self.assertEqual(["France", "Paris"], self.places_of(photo))

    def test_gps_stripped_keeps_a_position_of_unknown_origin(self) -> None:
        # Rows from before location_source: the position may be the user's.
        photo = self.scanned_and_placed()
        Photo.objects.filter(pk=photo.pk).update(location_source=None)
        photo = self.reload(photo)

        self.strip_position()
        photo = self.scan(photo)

        self.assertEqual(BERLIN, self.position(photo))
        self.assertEqual(["Berlin", "Germany"], self.places_of(photo))

    # ---- GPS changed in the file --------------------------------------

    def test_new_gps_in_the_file_replaces_the_position(self) -> None:
        photo = self.scanned_and_placed()

        self.tag_position(*PARIS)
        photo = self.scan(photo)

        self.assertEqual(PARIS, self.position(photo))
        # The old place went with the old position (#2253) ...
        self.assertEqual([], self.places_of(photo))
        # ... and the geolocation job looks up the new one.
        photo = self.geolocate(photo)
        self.assertEqual(["France", "Paris"], self.places_of(photo))
        self.assertEqual("Paris, France", self.search_location(photo))

    def test_new_gps_replaces_a_position_of_unknown_origin(self) -> None:
        photo = self.scanned_and_placed()
        Photo.objects.filter(pk=photo.pk).update(location_source=None)
        photo = self.reload(photo)

        self.tag_position(*PARIS)
        photo = self.scan(photo)

        self.assertEqual(PARIS, self.position(photo))

    def test_a_location_set_in_the_picker_survives_a_rescan(self) -> None:
        photo = self.scanned_and_placed()
        with patch("api.metadata.edits.reverse_geocode", side_effect=fake_geocoder):
            edits.set_location(photo, *PARIS, self.user)

        self.tag_position(*LISBON)
        photo = self.scan(photo)

        self.assertEqual(PARIS, self.position(photo))
        self.assertEqual(["France", "Paris"], self.places_of(photo))

    def test_a_location_the_user_removed_stays_removed(self) -> None:
        photo = self.scanned_and_placed()
        edits.set_location(photo, None, None, self.user)

        photo = self.scan(self.reload(photo))

        self.assertEqual((None, None), self.position(photo))

    def test_a_geolocation_job_does_not_bring_back_the_files_gps(self) -> None:
        # A full "Add geolocation" run used to read the file again (#2209).
        photo = self.scanned_and_placed()
        edits.set_location(photo, None, None, self.user)

        photo = self.geolocate(self.reload(photo))

        self.assertEqual((None, None), self.position(photo))
        self.assertEqual([], self.places_of(photo))

    # ---- the incremental geolocation job ------------------------------

    def queued_by_incremental_geolocation(self) -> list[object]:
        job_id = uuid.uuid4()
        with patch.object(processing_jobs, "enqueue_task") as enqueue:
            processing_jobs.add_geolocation(self.user, job_id, full_scan=False)
        return [call.args[1] for call in enqueue.call_args_list]

    def finished_geolocation_run(self) -> None:
        run = LongRunningJob.create_job(
            user=self.user,
            job_type=LongRunningJob.JOB_ADD_GEOLOCATION,
            start_now=True,
        )
        run.complete()

    def test_an_old_photo_whose_gps_changed_is_geolocated_again(self) -> None:
        photo = self.scanned_and_placed()
        Photo.objects.filter(pk=photo.pk).update(
            added_on=timezone.now() - timedelta(days=30)
        )
        self.finished_geolocation_run()
        self.assertEqual([], self.queued_by_incremental_geolocation())

        self.tag_position(*PARIS)
        self.scan(photo)

        self.assertEqual([photo.pk], self.queued_by_incremental_geolocation())
