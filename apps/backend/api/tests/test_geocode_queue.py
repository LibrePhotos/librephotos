import uuid
from unittest.mock import patch

from constance.test import override_config
from django.conf import settings
from django.test import TestCase
from django.utils import timezone

from api.directory_watcher.processing_jobs import add_geolocation, geolocation_job
from api.tests.utils import create_test_photo, create_test_user


class CapturingAsyncTask:
    calls = []

    def __init__(self, func, *args, **kwargs):
        self.func = func
        self.args = args
        self.kwargs = kwargs

    def run(self):
        CapturingAsyncTask.calls.append(
            {
                "func": self.func,
                "args": self.args,
                "kwargs": self.kwargs,
            }
        )
        return None


class GeocodeQueueTest(TestCase):
    def setUp(self):
        CapturingAsyncTask.calls = []

    def test_add_geolocation_enqueues_photo_jobs_on_dedicated_cluster(self):
        user = create_test_user()
        create_test_photo(owner=user, added_on=timezone.now())

        with (
            override_config(MAP_API_PROVIDER="mapbox"),
            patch("api.directory_watcher.processing_jobs.AsyncTask", CapturingAsyncTask),
            patch(
                "api.directory_watcher.processing_jobs.db.connections.close_all"
            ) as close_all,
            patch(
                "api.directory_watcher.processing_jobs.is_job_cancelled",
                return_value=False,
            ),
        ):
            close_all.return_value = None
            add_geolocation(user, uuid.uuid4(), full_scan=True)

        self.assertEqual(len(CapturingAsyncTask.calls), 1)
        self.assertEqual(
            CapturingAsyncTask.calls[0]["kwargs"].get("cluster"),
            settings.GEOCODE_Q_CLUSTER_NAME,
        )
        self.assertEqual(CapturingAsyncTask.calls[0]["kwargs"].get("provider"), "mapbox")
        self.assertEqual(
            CapturingAsyncTask.calls[0]["kwargs"].get("throttle_key"), "mapbox"
        )

    def test_geolocation_job_uses_snapshotted_provider(self):
        photo = create_test_photo(owner=create_test_user(), added_on=timezone.now())

        with (
            patch("api.models.photo.Photo._geolocate") as geolocate_mock,
            patch("api.models.photo.Photo._add_location_to_album_dates"),
            patch("api.directory_watcher.processing_jobs.update_scan_counter"),
        ):
            geolocation_job(photo, uuid.uuid4(), provider="mapbox")

        geolocate_mock.assert_called_once_with(provider="mapbox")
