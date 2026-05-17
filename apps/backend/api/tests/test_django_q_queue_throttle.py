from unittest.mock import patch

from constance.test import override_config
from django.test import TestCase
from django.utils import timezone

from django_q.brokers import get_broker
from django_q.conf import Conf
from django_q.models import OrmQ, OrmQThrottleState
from django_q.tasks import async_task

from api.geocode.throttle import (
    build_default_geocode_throttle_profiles,
    clear_geocode_throttle_profiles_cache,
    serialize_geocode_throttle_profiles,
)


class DjangoQQueueThrottleTest(TestCase):
    def tearDown(self):
        clear_geocode_throttle_profiles_cache()
        super().tearDown()

    def test_orm_broker_records_throttle_key(self):
        broker = get_broker("geocode")

        async_task("math.floor", 1.5, cluster="geocode", throttle_key="mapbox")

        queued = OrmQ.objects.get(key=broker.list_key)

        self.assertEqual(queued.throttle_key, "mapbox")

    @override_config(
        GEOCODE_THROTTLE_PROFILES=serialize_geocode_throttle_profiles(
            {
                **build_default_geocode_throttle_profiles(),
                "mapbox": {
                    "enabled": True,
                    "requests_per_second": 0.5,
                    "burst_size": 1,
                },
            }
        )
    )
    def test_orm_broker_uses_runtime_throttle_profiles(self):
        clear_geocode_throttle_profiles_cache()
        broker = get_broker("geocode")

        async_task("math.floor", 1.5, cluster="geocode", throttle_key="mapbox")
        async_task("math.ceil", 1.5, cluster="geocode", throttle_key="mapbox")

        with patch.object(Conf, "POLL", 0):
            first_batch = broker.dequeue()
            blocked_batch = broker.dequeue()

        self.assertEqual(len(first_batch), 1)
        self.assertIsNone(blocked_batch)

        state = OrmQThrottleState.objects.get(
            queue_key=broker.list_key,
            throttle_key="mapbox",
        )
        self.assertLess(state.available_tokens, 1)
        self.assertGreater(state.next_available_at, timezone.now())

    def test_orm_broker_picks_up_runtime_config_changes_without_restart(self):
        limited_profiles = build_default_geocode_throttle_profiles()
        limited_profiles["mapbox"] = {
            "enabled": True,
            "requests_per_second": 0.5,
            "burst_size": 1,
        }
        disabled_profiles = build_default_geocode_throttle_profiles()
        disabled_profiles["mapbox"] = {
            "enabled": False,
            "requests_per_second": 0.5,
            "burst_size": 1,
        }

        with override_config(
            GEOCODE_THROTTLE_PROFILES=serialize_geocode_throttle_profiles(
                limited_profiles
            )
        ):
            clear_geocode_throttle_profiles_cache()
            broker = get_broker("geocode")
            async_task("math.floor", 1.5, cluster="geocode", throttle_key="mapbox")
            async_task("math.ceil", 1.5, cluster="geocode", throttle_key="mapbox")

            with patch.object(Conf, "POLL", 0):
                self.assertEqual(len(broker.dequeue()), 1)
                self.assertIsNone(broker.dequeue())

            with override_config(
                GEOCODE_THROTTLE_PROFILES=serialize_geocode_throttle_profiles(
                    disabled_profiles
                )
            ):
                clear_geocode_throttle_profiles_cache()
                with patch.object(Conf, "POLL", 0):
                    second_batch = broker.dequeue()

        self.assertEqual(len(second_batch), 1)

    def test_orm_broker_only_dequeues_due_tasks(self):
        broker = get_broker("geocode")
        now = timezone.now()

        ready = OrmQ.objects.create(
            key=broker.list_key,
            payload="ready",
            lock=now - timezone.timedelta(seconds=1),
            available_at=now - timezone.timedelta(seconds=1),
        )
        OrmQ.objects.create(
            key=broker.list_key,
            payload="delayed",
            lock=now - timezone.timedelta(seconds=1),
            available_at=now + timezone.timedelta(seconds=60),
        )

        tasks = broker.dequeue()

        self.assertEqual(len(tasks), 1)
        self.assertEqual(tasks[0][0], ready.pk)
