from __future__ import annotations

from django.db import models
from django.utils import timezone


class ErrorReport(models.Model):
    """One saved error, scrubbed, waiting for an admin to share it or not (#2938).

    The backend's own errors (``api.error_reports.capture``) and the web app's
    (forwarded to ``/api/error-reports/browser/``) end up here, after
    ``api.error_reports.scrub`` removed what could identify the instance, its
    users or their photos. ``event`` is the Sentry event exactly as it would be
    sent. The same error again within a day bumps ``occurrences`` and
    ``last_seen`` instead of adding a row; ``api.error_reports.store`` keeps at
    most the newest 30 rows, none older than 30 days.

    The whole instance shares one list: the rows belong to no user, and only
    admins read them.
    """

    SOURCE_SERVER = "server"
    SOURCE_BROWSER = "browser"
    SOURCE_CHOICES = (
        (SOURCE_SERVER, "Server"),
        (SOURCE_BROWSER, "Web app"),
    )

    source = models.CharField(max_length=16, choices=SOURCE_CHOICES)
    # A digest of the error's type, message and stack, for spotting repeats.
    fingerprint = models.CharField(max_length=64, db_index=True)
    title = models.CharField(max_length=512)
    level = models.CharField(max_length=16, default="error")
    release = models.CharField(max_length=64, blank=True, default="")
    event = models.JSONField()
    occurrences = models.PositiveIntegerField(default=1)
    first_seen = models.DateTimeField(default=timezone.now)
    last_seen = models.DateTimeField(default=timezone.now, db_index=True)
    sent_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ("-last_seen", "-id")
        verbose_name = "Error Report"
        verbose_name_plural = "Error Reports"

    def __str__(self) -> str:
        return f"Error report {self.id}: {self.title}"
