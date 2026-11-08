"""Where saved error reports go, and sending them there.

The ``ERROR_REPORTING`` site setting picks the destination of new reports:

* ``off`` (the default): none. Reports stay on this server until an admin
  sends one from the Error reports page; Send once goes to the maintainers.
* ``own_server``: the admin's GlitchTip or Sentry project, ``SENTRY_DSN``.
* ``maintainers``: the LibrePhotos maintainers' project,
  ``ERROR_REPORTING_MAINTAINERS_DSN``.

A report is sent as one Sentry envelope holding its saved, scrubbed event,
over one HTTPS POST with nothing else about the server.
"""

from __future__ import annotations

import json
import logging
import uuid

import requests
from constance import config as site_config
from django.conf import settings
from django.utils import timezone
from sentry_sdk.utils import BadDsn, Dsn

from api.error_reports.scrub import JsonObject, release
from api.models import ErrorReport

logger = logging.getLogger(__name__)

OFF = "off"
OWN_SERVER = "own_server"
MAINTAINERS = "maintainers"
MODES = (OFF, OWN_SERVER, MAINTAINERS)

REQUEST_TIMEOUT_SECONDS = 10


class SendError(Exception):
    """The report could not be delivered; the message says why, without the DSN."""


def reporting_mode() -> str:
    """The ``ERROR_REPORTING`` site setting; an unknown value counts as off."""
    mode = str(site_config.ERROR_REPORTING)
    return mode if mode in MODES else OFF


def _dsn_of(mode: str) -> str:
    if mode == OWN_SERVER:
        return settings.SENTRY_DSN.strip()
    if mode == MAINTAINERS:
        return settings.ERROR_REPORTING_MAINTAINERS_DSN.strip()
    return ""


def mode_available(mode: str) -> bool:
    """Whether ``mode`` has somewhere to send to (off always does)."""
    return mode == OFF or bool(_dsn_of(mode))


def sharing_dsn() -> str | None:
    """Where new reports go by themselves; None while reporting is off."""
    return _dsn_of(reporting_mode()) or None


def manual_dsn() -> str | None:
    """Where Send once and Send all go: the chosen server, else the maintainers."""
    return sharing_dsn() or _dsn_of(MAINTAINERS) or None


def envelope_bytes(event: JsonObject, event_id: str) -> bytes:
    """``event`` as a Sentry envelope, under a new event id.

    Three lines: the envelope's header, the item's header, the event.
    """
    payload = json.dumps({**event, "event_id": event_id}).encode()
    header = {"event_id": event_id, "sent_at": timezone.now().isoformat()}
    item = {"type": "event", "content_type": "application/json", "length": len(payload)}
    return b"\n".join(
        [json.dumps(header).encode(), json.dumps(item).encode(), payload, b""]
    )


def send_report(report: ErrorReport, dsn: str) -> None:
    """Send ``report`` to ``dsn`` and mark it sent; ``SendError`` when that fails."""
    try:
        auth = Dsn(dsn).to_auth(client=f"librephotos/{release()}")
    except BadDsn as error:
        raise SendError("The error reporting server is not a valid DSN.") from error
    event_id = uuid.uuid4().hex
    try:
        response = requests.post(
            auth.get_api_url(),
            data=envelope_bytes(report.event, event_id),
            headers={
                "Content-Type": "application/x-sentry-envelope",
                "X-Sentry-Auth": auth.to_header(),
            },
            timeout=REQUEST_TIMEOUT_SECONDS,
        )
    except requests.RequestException as error:
        raise SendError("The error reporting server could not be reached.") from error
    if not 200 <= response.status_code < 300:
        raise SendError(f"The error reporting server answered {response.status_code}.")
    report.sent_at = timezone.now()
    report.save(update_fields=["sent_at"])


def share_new_report(report_id: int) -> None:
    """Send a new report by itself when the site setting says so."""
    dsn = sharing_dsn()
    if dsn is None:
        return
    report = ErrorReport.objects.filter(id=report_id).first()
    if report is None or report.sent_at is not None:
        return
    try:
        send_report(report, dsn)
    except SendError as error:
        logger.warning("Error report %s was not sent: %s", report_id, error)


def send_saved_reports(dsn: str) -> tuple[int, int]:
    """Send every report not sent yet; how many were sent and how many failed."""
    sent = failed = 0
    for report in ErrorReport.objects.filter(sent_at__isnull=True).order_by("id"):
        try:
            send_report(report, dsn)
        except SendError as error:
            logger.warning("Error report %s was not sent: %s", report.id, error)
            failed += 1
        else:
            sent += 1
    return sent, failed
