from unittest.mock import patch

from django.test import TestCase
from django.utils import timezone

from django_q.brokers import get_broker
from django_q.conf import Conf
from django_q.models import OrmQ


class DjangoQQueueThrottleTest(TestCase):
    def test_orm_broker_spaces_tasks_when_throttle_is_enabled(self):
        broker = get_broker("geocode")

        with patch.object(Conf, "THROTTLE", 1.5):
            first_id = broker.enqueue("first")
            second_id = broker.enqueue("second")

        first = OrmQ.objects.get(pk=first_id)
        second = OrmQ.objects.get(pk=second_id)

        self.assertLessEqual(first.available_at, second.available_at)
        self.assertGreaterEqual(
            (second.available_at - first.available_at).total_seconds(),
            1.4,
        )

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
