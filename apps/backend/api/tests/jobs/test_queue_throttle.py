import datetime
import uuid
from unittest.mock import patch

from django.test import TestCase
from django.utils import timezone

from api.directory_watcher.processing_jobs import geolocation_job
from api.geocode import rate_limit
from api.jobs import store, throttle
from api.jobs.queue import enqueue_task
from api.models.task_queue import DEFAULT_QUEUE, GEOCODE_QUEUE, QUEUES


class ThrottleTest(TestCase):
    def test_the_first_call_goes_and_the_next_waits_its_turn(self):
        now = timezone.now()

        self.assertEqual(0.0, throttle.take("geocode:nominatim", 1.1, now))
        self.assertAlmostEqual(
            1.1, throttle.take("geocode:nominatim", 1.1, now), places=3
        )
        later = now + datetime.timedelta(seconds=1.2)
        self.assertEqual(0.0, throttle.take("geocode:nominatim", 1.1, later))

    def test_keys_do_not_share_a_slot(self):
        now = timezone.now()

        throttle.take("geocode:nominatim", 1.1, now)

        self.assertEqual(0.0, throttle.take("geocode:mapbox", 0.05, now))

    def test_wait_sleeps_until_the_slot_is_free(self):
        slept = []
        throttle.take("geocode:nominatim", 1.1)

        with patch.object(throttle, "take", side_effect=[0.7, 0.0]):
            throttle.wait("geocode:nominatim", 1.1, sleep=slept.append)

        self.assertEqual([0.7], slept)

    def test_no_delay_never_touches_the_database(self):
        with patch.object(throttle, "take") as take:
            throttle.wait("geocode:exiftool", 0)

        take.assert_not_called()


class ProviderDelayTest(TestCase):
    def test_nominatim_gets_its_one_request_per_second(self):
        with patch.object(rate_limit.throttle, "wait") as wait:
            rate_limit.wait("nominatim")

        wait.assert_called_once_with("geocode:nominatim", 1.1)

    def test_exiftool_runs_here_and_waits_for_nothing(self):
        with patch.object(rate_limit.throttle, "wait") as wait:
            rate_limit.wait("exiftool")

        wait.assert_called_once_with("geocode:exiftool", 0)


class GeocodeQueueTest(TestCase):
    def test_geolocation_tasks_run_one_at_a_time_beside_other_work(self):
        for index in range(2):
            enqueue_task(geolocation_job, str(uuid.UUID(int=index)), "job")
        enqueue_task(record_nothing)

        first = store.claim("a", QUEUES, store.CAPS)
        second = store.claim("b", QUEUES, store.CAPS)

        self.assertEqual(GEOCODE_QUEUE, first.queue)
        self.assertEqual(DEFAULT_QUEUE, second.queue)
        self.assertIsNone(store.claim("c", QUEUES, store.CAPS))


def record_nothing() -> None:
    return None
