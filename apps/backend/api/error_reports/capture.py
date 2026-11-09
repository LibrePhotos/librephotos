"""Catching errors with the Sentry SDK and keeping them here instead of sending them.

``start_capture`` (called by ``ApiConfig.ready()`` in the web server, the
django-q cluster and every management command) sets the SDK up with
``ErrorReportTransport``, which never talks to a server itself: it hands each
error event to the background thread (``background``), which scrubs and saves
it (``store``) and sends it on only when the site setting says so (``send``).
The SDK runs without performance tracing, sessions, breadcrumbs, local
variables or request bodies, so an error event is all it ever produces.

The web app's errors come in through ``ingest_browser_envelope`` and take the
same way from the scrubber on.
"""

from __future__ import annotations

import json
import logging
import threading
import time
from collections.abc import Callable

import sentry_sdk
from sentry_sdk.envelope import Envelope
from sentry_sdk.integrations.atexit import AtexitIntegration
from sentry_sdk.integrations.dedupe import DedupeIntegration
from sentry_sdk.integrations.django import DjangoIntegration
from sentry_sdk.integrations.excepthook import ExcepthookIntegration
from sentry_sdk.integrations.logging import LoggingIntegration, ignore_logger
from sentry_sdk.integrations.threading import ThreadingIntegration
from sentry_sdk.transport import Transport

from api.error_reports import background
from api.error_reports.scrub import (
    SOURCE_BROWSER,
    SOURCE_SERVER,
    Json,
    release,
)
from api.error_reports.send import share_new_report
from api.error_reports.store import save_event
from api.models import ErrorReport

# Events one process saves a minute at most; an error in a loop must not fill
# the database or the queue.
MAX_EVENTS_PER_MINUTE = 20
# Error events one browser envelope may carry.
MAX_BROWSER_EVENTS = 5

# Loggers whose records are never reported: this package's own (a failure
# to save a report must not become a report) and noise.
IGNORED_LOGGERS = (
    "api.error_reports",
    "api.error_reports.*",
    "django.security.DisallowedHost",
)


class _RateLimit:
    """At most ``limit`` events a minute, per process."""

    def __init__(self, limit: int) -> None:
        self.limit = limit
        self.window = 0.0
        self.count = 0
        self.lock = threading.Lock()

    def allow(self) -> bool:
        with self.lock:
            now = time.monotonic()
            if now - self.window >= 60:
                self.window, self.count = now, 0
            self.count += 1
            return self.count <= self.limit


_rate_limit = _RateLimit(MAX_EVENTS_PER_MINUTE)


def _events(envelope: Envelope) -> list[dict[str, Json]]:
    """The error events in ``envelope``, as plain JSON; nothing else is kept."""
    events: list[dict[str, Json]] = []
    for item in envelope.items:
        if item.type != "event":
            continue
        event = json.loads(item.get_bytes())
        if isinstance(event, dict):
            events.append(event)
    return events


def record(event: dict[str, Json], source: str) -> tuple[ErrorReport, bool]:
    """Save ``event`` and, when the site setting says so, send a new report."""
    report, created = save_event(event, source)
    if created:
        share_new_report(report.id)
    return report, created


def _record_later(event: dict[str, Json]) -> Callable[[], None]:
    def job() -> None:
        record(event, SOURCE_SERVER)

    return job


class ErrorReportTransport(Transport):
    """The SDK's way out, which leads into the ``ErrorReport`` table."""

    def capture_envelope(self, envelope: Envelope) -> None:
        for event in _events(envelope):
            if _rate_limit.allow():
                background.run_in_background(_record_later(event))

    def flush(self, timeout: float, callback: object = None) -> None:
        background.flush(timeout)


def start_capture() -> None:
    """Capture this process's errors into the saved error reports."""
    sentry_sdk.init(
        transport=ErrorReportTransport(),
        release=release(),
        environment="production",
        # The host name would name the server; scrub_event drops it as well.
        server_name="",
        send_default_pii=False,
        include_local_variables=False,
        max_request_body_size="never",
        max_breadcrumbs=0,
        send_client_reports=False,
        auto_session_tracking=False,
        default_integrations=False,
        auto_enabling_integrations=False,
        integrations=[
            AtexitIntegration(),
            DedupeIntegration(),
            ExcepthookIntegration(),
            ThreadingIntegration(),
            LoggingIntegration(level=None, event_level=logging.ERROR),
            DjangoIntegration(
                transaction_style="url",
                middleware_spans=False,
                signals_spans=False,
                cache_spans=False,
            ),
        ],
    )
    for name in IGNORED_LOGGERS:
        ignore_logger(name)


class InvalidEnvelopeError(ValueError):
    """The web app sent something that is not a Sentry envelope."""


def ingest_browser_envelope(raw: bytes) -> list[ErrorReport]:
    """Save the web app's error events; new ones are sent when sharing is on.

    Saved at once, so the answer says what was kept; sending runs on the
    background thread, so a slow reporting server never holds the request.
    """
    try:
        events = _events(Envelope.deserialize(raw))
    except (ValueError, TypeError, AttributeError) as error:
        raise InvalidEnvelopeError("Not a Sentry envelope.") from error
    reports: list[ErrorReport] = []
    for event in events[:MAX_BROWSER_EVENTS]:
        report, created = save_event(event, SOURCE_BROWSER)
        reports.append(report)
        if created:
            report_id = report.id
            background.run_in_background(lambda: share_new_report(report_id))
    return reports
