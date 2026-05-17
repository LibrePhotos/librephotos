from datetime import timedelta
from time import sleep

from django import db
from django.db import transaction
from django.utils import timezone

from django_q.brokers import Broker
from django_q.conf import Conf, logger
from django_q.models import OrmQ, OrmQThrottleState
from django_q.signing import SignedPackage


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

    def _get_runtime_throttle_profile(self, throttle_key: str):
        if not throttle_key:
            return None
        try:
            from api.geocode.throttle import get_geocode_throttle_profile

            return get_geocode_throttle_profile(throttle_key)
        except Exception as exc:
            logger.warning(
                "Falling back to unthrottled dequeue for %s: %s", throttle_key, exc
            )
            return None

    def _try_claim_task(self, task):
        now = timezone.now()
        with transaction.atomic(using=Conf.ORM):
            queued = (
                self.get_connection()
                .select_for_update()
                .filter(
                    pk=task.pk,
                    lock=task.lock,
                    available_at__lte=now,
                )
                .first()
            )
            if not queued:
                return None

            if queued.throttle_key and not self._consume_runtime_token(
                queued.throttle_key, now
            ):
                return None

            queued.lock = self.timeout(task)
            queued.save(update_fields=["lock"])
            return (queued.pk, queued.payload)

    def _consume_runtime_token(self, throttle_key: str, now):
        profile = self._get_runtime_throttle_profile(throttle_key)
        if not profile or not profile.get("enabled", True):
            return True

        requests_per_second = float(profile["requests_per_second"])
        burst_size = max(1, int(profile["burst_size"]))

        state, _ = OrmQThrottleState.objects.using(Conf.ORM).select_for_update().get_or_create(
            queue_key=self.list_key or Conf.CLUSTER_NAME,
            throttle_key=throttle_key,
            defaults={
                "available_tokens": float(burst_size),
                "last_refilled_at": now,
                "next_available_at": now,
            },
        )

        elapsed_seconds = max(
            0.0, (now - state.last_refilled_at).total_seconds()
        )
        available_tokens = min(
            float(burst_size),
            float(state.available_tokens) + (elapsed_seconds * requests_per_second),
        )

        if available_tokens < 1:
            state.available_tokens = available_tokens
            state.last_refilled_at = now
            state.next_available_at = now + timedelta(
                seconds=(1 - available_tokens) / requests_per_second
            )
            state.save(
                update_fields=[
                    "available_tokens",
                    "last_refilled_at",
                    "next_available_at",
                    "updated_at",
                ]
            )
            return False

        remaining_tokens = available_tokens - 1
        state.available_tokens = remaining_tokens
        state.last_refilled_at = now
        state.next_available_at = (
            now
            if remaining_tokens >= 1
            else now + timedelta(seconds=(1 - remaining_tokens) / requests_per_second)
        )
        state.save(
            update_fields=[
                "available_tokens",
                "last_refilled_at",
                "next_available_at",
                "updated_at",
            ]
        )
        return True

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
        throttle_key = None
        try:
            throttle_key = SignedPackage.loads(task).get("throttle_key")
        except Exception:
            logger.debug("Unable to extract throttle key from queued payload.")
        with transaction.atomic(using=Conf.ORM):
            package = self.get_connection().create(
                key=self.list_key or Conf.CLUSTER_NAME,
                payload=task,
                lock=timezone.now(),
                available_at=timezone.now(),
                throttle_key=throttle_key,
            )
        return package.pk

    def dequeue(self):
        candidates = self.get_connection().filter(
            key=self.list_key,
            lock__lt=timezone.now(),
            available_at__lte=timezone.now(),
        ).order_by("available_at", "id")[
            0 : max(Conf.BULK * 10, 10)  # noqa: E203
        ]
        if candidates:
            task_list = []
            for task in candidates:
                claimed = self._try_claim_task(task)
                if claimed:
                    task_list.append(claimed)
                if len(task_list) >= Conf.BULK:
                    break
            if task_list:
                return task_list
        # empty queue, spare the cpu
        sleep(Conf.POLL)

    def delete_queue(self):
        return self.purge_queue()

    def delete(self, task_id):
        self.get_connection().filter(pk=task_id).delete()

    def acknowledge(self, task_id):
        return self.delete(task_id)
