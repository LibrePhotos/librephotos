from __future__ import annotations

import time
from collections.abc import Callable
from datetime import datetime, timedelta

from django.db import IntegrityError, transaction
from django.utils import timezone

from api.models.task_queue import Throttle


def take(key: str, seconds: float, now: datetime | None = None) -> float:
    now = now or timezone.now()
    following = now + timedelta(seconds=seconds)
    with transaction.atomic():
        if Throttle.objects.filter(key=key, next_at__lte=now).update(next_at=following):
            return 0.0
        try:
            with transaction.atomic():
                Throttle.objects.create(key=key, next_at=following)
        except IntegrityError:
            next_at = (
                Throttle.objects.filter(key=key)
                .values_list("next_at", flat=True)
                .first()
            )
            if next_at is None:
                return 0.0
            return max(0.0, (next_at - now).total_seconds())
        return 0.0


def wait(
    key: str, seconds: float, sleep: Callable[[float], None] | None = None
) -> None:
    if seconds <= 0:
        return
    while True:
        delay = take(key, seconds)
        if delay <= 0:
            return
        (sleep or time.sleep)(min(delay, seconds))
