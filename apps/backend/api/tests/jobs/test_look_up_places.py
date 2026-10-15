"""Admins look the place names of every photo up again (#2302).

Switching the Map Provider renames nothing: ``geolocate_photo`` skips a photo
whose place is current for its position, so a library geocoded by Nominatim
keeps Nominatim's names after the switch to ExifTool. Look Up Place Names
(Admin Area > Admin Tools) asks the current provider again for every user's
photos with a position, through the geolocation job's per-photo task with
``force``.
"""

import uuid
from unittest import mock

from constance.models import Constance
from constance.test import override_config
from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from api.directory_watcher import processing_jobs
from api.directory_watcher.processing_jobs import (
    add_geolocation,
    geolocation_job,
    look_up_places,
)
from api.geocode.geocode import reverse_geocode
from api.geocode.parsers.exiftool import parse as parse_exiftool
from api.models import AlbumDate, LongRunningJob
from api.models.album_place import AlbumPlace, get_album_place
from api.tests.metadata.test_geocode_exiftool import ZERMATT, sidecar_answer
from api.tests.metadata.test_place_names import STORED_NOMINATIM_ZERMATT
from api.tests.utils import (
    api_error,
    create_test_album_date,
    create_test_job,
    create_test_photo,
    create_test_user,
)

URL = "/api/look-up-places/"
POSITION = (46.0291, 7.7545)


def _geocoded_photo(owner, **fields):
    """A photo in Zermatt whose place Nominatim looked up before #2302."""
    return create_test_photo(
        owner=owner,
        exif_timestamp=timezone.now(),
        exif_gps_lat=POSITION[0],
        exif_gps_lon=POSITION[1],
        geocoded_lat=POSITION[0],
        geocoded_lon=POSITION[1],
        geolocation_json=STORED_NOMINATIM_ZERMATT,
        **fields,
    )


@override_config(MAP_API_PROVIDER="exiftool")
@mock.patch("api.geocode.exiftool_provider.sidecars.post")
class ForcedLookupTest(TestCase):
    def setUp(self):
        self.user = create_test_user()
        self.photo = _geocoded_photo(self.user)
        get_album_place("Vispastrasse", owner=self.user).photos.add(self.photo)
        create_test_album_date(
            owner=self.user, date=self.photo.exif_timestamp.date()
        ).photos.add(self.photo)

    def run_task(self, **kwargs):
        job = create_test_job(self.user, LongRunningJob.JOB_LOOK_UP_PLACES)
        job.update_progress(current=0, target=1)
        geolocation_job(self.photo.pk, job.job_id, **kwargs)
        self.photo.refresh_from_db()

    def test_without_force_a_current_place_is_kept(self, post):
        self.run_task()

        post.assert_not_called()
        self.assertEqual(self.photo.geolocation_json, STORED_NOMINATIM_ZERMATT)

    def test_force_asks_the_current_provider_again(self, post):
        post.return_value = sidecar_answer([ZERMATT])

        self.run_task(force=True)

        post.assert_called_once()
        self.assertEqual(self.photo.geolocation_json["provider"], "exiftool")
        self.assertEqual(
            self.photo.geolocation_json, parse_exiftool(ZERMATT, *POSITION)
        )
        titles = set(
            AlbumPlace.objects.filter(photos=self.photo).values_list("title", flat=True)
        )
        self.assertEqual(titles, {"Zermatt", "Visp District", "Valais", "Switzerland"})

    def test_a_failed_forced_lookup_keeps_the_place(self, post):
        post.side_effect = OSError("exif sidecar is down")

        with self.assertLogs("api.geocode.geocode", "WARNING"):
            self.run_task(force=True)

        self.assertEqual(self.photo.geolocation_json, STORED_NOMINATIM_ZERMATT)


class LookUpPlacesJobTest(TestCase):
    def setUp(self):
        self.admin = create_test_user(is_admin=True)
        self.other = create_test_user()
        self.job_id = str(uuid.uuid4())
        create_test_job(
            self.admin, LongRunningJob.JOB_LOOK_UP_PLACES, job_id=self.job_id
        )

    def job(self):
        return LongRunningJob.objects.get(job_id=self.job_id)

    def test_queues_a_forced_lookup_for_every_users_photo_with_a_position(self):
        mine = _geocoded_photo(self.admin)
        theirs = _geocoded_photo(self.other)
        create_test_photo(owner=self.other)  # no position

        with mock.patch.object(processing_jobs, "enqueue_task") as enqueue:
            look_up_places(self.admin, self.job_id)

        queued = {call.args[1] for call in enqueue.call_args_list}
        self.assertEqual(queued, {mine.pk, theirs.pk})
        for call in enqueue.call_args_list:
            self.assertIs(call.args[0], geolocation_job)
            self.assertEqual(call.args[2], self.job_id)
            self.assertEqual(call.kwargs, {"force": True})
        job = self.job()
        self.assertEqual(job.progress_target, 2)
        self.assertFalse(job.finished)

    def test_the_day_albums_name_their_places_again(self):
        photo = _geocoded_photo(self.other)
        day = create_test_album_date(
            owner=self.other,
            date=photo.exif_timestamp.date(),
            location={"places": ["Valais/Wallis"]},
        )

        with mock.patch.object(processing_jobs, "enqueue_task"):
            look_up_places(self.admin, self.job_id)

        day.refresh_from_db()
        self.assertIsNone(day.location)

    def test_no_photo_with_a_position_completes_at_once(self):
        create_test_photo(owner=self.admin)
        day = create_test_album_date(
            owner=self.admin, date=timezone.now().date(), location={"places": ["X"]}
        )

        with mock.patch.object(processing_jobs, "enqueue_task") as enqueue:
            look_up_places(self.admin, self.job_id)

        enqueue.assert_not_called()
        self.assertTrue(self.job().finished)
        day.refresh_from_db()
        self.assertEqual(day.location, {"places": ["X"]})

    def test_a_job_cancelled_while_queued_does_nothing(self):
        _geocoded_photo(self.admin)
        LongRunningJob.objects.filter(job_id=self.job_id).update(
            cancelled=True, finished=True
        )

        with mock.patch.object(processing_jobs, "enqueue_task") as enqueue:
            look_up_places(self.admin, self.job_id)

        enqueue.assert_not_called()

    def test_a_failure_fails_the_job(self):
        _geocoded_photo(self.admin)

        with (
            mock.patch.object(
                AlbumDate.objects, "exclude", side_effect=RuntimeError("db gone")
            ),
            self.assertLogs("api.directory_watcher.processing_jobs", "ERROR"),
        ):
            look_up_places(self.admin, self.job_id)

        self.assertTrue(self.job().failed)

    def test_the_scan_follow_up_is_not_forced(self):
        _geocoded_photo(self.admin)
        job_id = uuid.uuid4()

        with mock.patch.object(processing_jobs, "enqueue_task") as enqueue:
            add_geolocation(self.admin, job_id, full_scan=True)

        self.assertEqual(enqueue.call_args.kwargs, {})


class LookUpPlacesViewTest(TestCase):
    def setUp(self):
        self.client = APIClient()

    def test_an_admin_starts_the_job(self):
        admin = create_test_user(is_admin=True)
        self.client.force_authenticate(user=admin)
        with (
            mock.patch("api.jobs.queue.AsyncTask") as async_task,
            self.captureOnCommitCallbacks(execute=True),
        ):
            response = self.client.post(URL)

        self.assertEqual(response.status_code, 200)
        job = LongRunningJob.objects.get(job_id=response.json()["job_id"])
        self.assertEqual(job.job_type, LongRunningJob.JOB_LOOK_UP_PLACES)
        self.assertEqual(job.started_by, admin)
        self.assertEqual(async_task.call_args.args, (look_up_places, admin))

    def test_a_second_start_while_it_runs_is_refused(self):
        admin = create_test_user(is_admin=True)
        create_test_job(admin, LongRunningJob.JOB_LOOK_UP_PLACES)
        self.client.force_authenticate(user=admin)

        with mock.patch("api.jobs.queue.AsyncTask") as async_task:
            response = self.client.post(URL)

        self.assertEqual(response.status_code, 409)
        self.assertEqual(api_error(response)["code"], "job_already_running")
        async_task.assert_not_called()

    @override_settings(FEATURE_REVERSE_GEOCODING=False)
    def test_refused_while_reverse_geocoding_is_off(self):
        self.client.force_authenticate(user=create_test_user(is_admin=True))

        with mock.patch("api.jobs.queue.AsyncTask") as async_task:
            response = self.client.post(URL)

        self.assertEqual(response.status_code, 400)
        self.assertEqual(api_error(response)["code"], "reverse_geocoding_disabled")
        async_task.assert_not_called()

    def test_a_normal_user_may_not_start_it(self):
        self.client.force_authenticate(user=create_test_user())

        with mock.patch("api.jobs.queue.AsyncTask") as async_task:
            response = self.client.post(URL)

        self.assertEqual(response.status_code, 403)
        self.assertFalse(LongRunningJob.objects.exists())
        async_task.assert_not_called()


@mock.patch("api.geocode.geocode.wait_for_provider")
@mock.patch("api.geocode.exiftool_provider.sidecars.post")
@mock.patch("geopy.get_geocoder_for_service")
class DefaultProviderTest(TestCase):
    """New installs look places up offline; existing ones keep what is stored."""

    def test_without_a_stored_provider_exiftool_answers(
        self, get_geocoder, post, _wait
    ):
        Constance.objects.filter(key="MAP_API_PROVIDER").delete()
        post.return_value = sidecar_answer([ZERMATT])

        self.assertEqual(reverse_geocode(*POSITION), parse_exiftool(ZERMATT, *POSITION))
        get_geocoder.assert_not_called()

    @override_config(MAP_API_PROVIDER="nominatim")
    def test_a_stored_nominatim_keeps_answering(self, get_geocoder, post, _wait):
        get_geocoder.return_value.return_value.reverse.return_value = None

        reverse_geocode(*POSITION)

        get_geocoder.assert_called_once_with("nominatim")
        post.assert_not_called()
