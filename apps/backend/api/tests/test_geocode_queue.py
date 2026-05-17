import uuid
from unittest.mock import patch

from django.conf import settings
from django.test import TestCase
from django.utils import timezone

from api.directory_watcher.processing_jobs import add_geolocation
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
