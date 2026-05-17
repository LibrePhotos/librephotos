from datetime import timedelta
from time import sleep

from django import db
from django.db import transaction
from django.utils import timezone

from django_q.brokers import Broker
from django_q.conf import Conf, logger
from django_q.models import OrmQ


class ORM(Broker):
    @staticmethod
    def get_connection(list_key: str = None):
        if transaction.get_autocommit(
            using=Conf.ORM
        ):  # Only True when not in an atomic block
            # Make sure stale connections in the broker thread are explicitly
            #   closed before attempting DB access.
            # logger.debug("Broker thread calling close_old_connections")
            db.close_old_connections()
        else:
            logger.debug("Broker in an atomic transaction")
        return OrmQ.objects.using(Conf.ORM)

    def timeout(self, task):
        return timezone.now() + timedelta(seconds=Conf.RETRY)

    def next_available_at(self):
        now = timezone.now()
        throttle = Conf.THROTTLE
        if throttle <= 0:
            return now

        latest = (
            self.get_connection()
            .filter(key=self.list_key)
            .order_by("-available_at", "-id")
            .first()
        )
        if latest and latest.available_at:
            return max(now, latest.available_at) + timedelta(seconds=throttle)
        return now

    def queue_size(self) -> int:
        return self.get_connection().filter(key=self.list_key, lock__lte=timezone.now()).count()

    def lock_size(self) -> int:
        return (
            self.get_connection()
            .filter(key=self.list_key, lock__gt=timezone.now())
            .count()
        )

    def purge_queue(self):
        return self.get_connection().filter(key=self.list_key).delete()

    def ping(self) -> bool:
        return True

    def info(self) -> str:
        if not self._info:
            self._info = f"ORM {Conf.ORM}"
        return self._info

    def fail(self, task_id):
        self.delete(task_id)

    def enqueue(self, task):
        # list_key might be null (e.g. in a test setup) but OrmQ.key has not-null constraint
        with transaction.atomic(using=Conf.ORM):
            package = self.get_connection().create(
                key=self.list_key or Conf.CLUSTER_NAME,
                payload=task,
                lock=timezone.now(),
                available_at=self.next_available_at(),
            )
        return package.pk

    def dequeue(self):
        tasks = self.get_connection().filter(
            key=self.list_key,
            lock__lt=timezone.now(),
            available_at__lte=timezone.now(),
        )[
            0 : Conf.BULK  # noqa: E203
        ]
        if tasks:
            task_list = []
            for task in tasks:
                if (
                    self.get_connection()
                    .filter(id=task.id, lock=task.lock)
                    .update(lock=self.timeout(task))
                ):
                    task_list.append((task.pk, task.payload))
                # else don't process, as another cluster has been faster than us on
                # that task
            return task_list
        # empty queue, spare the cpu
        sleep(Conf.POLL)

    def delete_queue(self):
        return self.purge_queue()

    def delete(self, task_id):
        self.get_connection().filter(pk=task_id).delete()

    def acknowledge(self, task_id):
        return self.delete(task_id)
