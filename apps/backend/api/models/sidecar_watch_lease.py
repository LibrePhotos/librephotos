from __future__ import annotations

import datetime

from django.db import models
from django.utils import timezone

# Expired from the start: a new row is free to take.
_NEVER = datetime.datetime(2000, 1, 1, tzinfo=datetime.UTC)


class SidecarWatchLeaseManager(models.Manager["SidecarWatchLease"]):
    def take(self, service: str, holder: str, seconds: float) -> bool:
        """Whether ``holder`` now watches ``service`` for ``seconds``.

        One conditional update: it only moves a lease that has expired (or
        that ``holder`` holds already), so of two watchdog runs in different
        processes only one gets it.
        """
        self.get_or_create(service=service, defaults={"expires_at": _NEVER})
        now = timezone.now()
        return bool(
            self.filter(service=service)
            .filter(models.Q(expires_at__lte=now) | models.Q(holder=holder))
            .update(holder=holder, expires_at=now + datetime.timedelta(seconds=seconds))
        )

    def give_back(self, service: str, holder: str) -> None:
        self.filter(service=service, holder=holder).update(expires_at=_NEVER)


class SidecarWatchLease(models.Model):
    """Which watchdog run checks a sidecar right now, and until when.

    The watchdog (api.runtime.supervisor.check_services) runs every minute in
    whichever cluster worker picks up the schedule, and a run that waits for a
    busy sidecar's patient health probe outlasts the minute. The lease keeps a
    second run from probing, stopping or starting the same sidecar meanwhile.
    A run that dies holding it blocks that sidecar only until ``expires_at``.
    """

    service = models.CharField(max_length=64, unique=True)
    holder = models.CharField(max_length=64, blank=True, default="")
    expires_at = models.DateTimeField()

    objects = SidecarWatchLeaseManager()

    class Meta:
        verbose_name = "Sidecar Watch Lease"
        verbose_name_plural = "Sidecar Watch Leases"

    def __str__(self) -> str:
        return f"Watch of {self.service}"
