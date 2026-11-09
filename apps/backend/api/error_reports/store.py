"""The saved error reports: scrubbed first, repeats counted, the list kept short."""

from __future__ import annotations

import datetime
import json
from collections.abc import Mapping

from django.db.models import F
from django.utils import timezone

from api.error_reports.scrub import (
    Json,
    JsonObject,
    fingerprint,
    scrub_context,
    scrub_event,
    title,
)
from api.models import ErrorReport

# The list keeps the newest reports only, and none past a month.
MAX_REPORTS = 30
MAX_AGE = datetime.timedelta(days=30)
# The same error again within this time counts as an occurrence, not a report.
REPEAT_WINDOW = datetime.timedelta(days=1)
# A saved event larger than this loses its lines of code, then frames.
MAX_EVENT_BYTES = 64 * 1024


def _size(event: JsonObject) -> int:
    return len(json.dumps(event))


def _frames(event: JsonObject) -> list[list[Json]]:
    exception = event.get("exception")
    values = exception.get("values") if isinstance(exception, dict) else None
    found: list[list[Json]] = []
    for value in values if isinstance(values, list) else []:
        stack = value.get("stacktrace") if isinstance(value, dict) else None
        frames = stack.get("frames") if isinstance(stack, dict) else None
        if isinstance(frames, list):
            found.append(frames)
    return found


def fit(event: JsonObject) -> JsonObject:
    """``event`` within ``MAX_EVENT_BYTES``: code lines go first, then old frames."""
    if _size(event) <= MAX_EVENT_BYTES:
        return event
    for frames in _frames(event):
        for frame in frames:
            if isinstance(frame, dict):
                frame.pop("pre_context", None)
                frame.pop("post_context", None)
    while _size(event) > MAX_EVENT_BYTES and any(
        len(frames) > 1 for frames in _frames(event)
    ):
        for frames in _frames(event):
            if len(frames) > 1:
                del frames[0]
    return event


def prune(now: datetime.datetime | None = None) -> None:
    """Delete reports past ``MAX_AGE`` and all but the newest ``MAX_REPORTS``."""
    now = now or timezone.now()
    ErrorReport.objects.filter(last_seen__lt=now - MAX_AGE).delete()
    older = list(
        ErrorReport.objects.order_by("-last_seen", "-id").values_list("id", flat=True)[
            MAX_REPORTS:
        ]
    )
    if older:
        ErrorReport.objects.filter(id__in=older).delete()


def save_event(event: Mapping[str, Json], source: str) -> tuple[ErrorReport, bool]:
    """Scrub ``event`` and save it; True when it is a new report, not a repeat."""
    scrubbed = fit(scrub_event(event, scrub_context(), source=source))
    now = timezone.now()
    digest = fingerprint(scrubbed)
    repeat = (
        ErrorReport.objects.filter(
            fingerprint=digest, last_seen__gte=now - REPEAT_WINDOW
        )
        .order_by("-last_seen")
        .first()
    )
    if repeat is not None:
        ErrorReport.objects.filter(id=repeat.id).update(
            occurrences=F("occurrences") + 1, last_seen=now
        )
        repeat.refresh_from_db()
        return repeat, False
    level = scrubbed.get("level")
    report = ErrorReport.objects.create(
        source=source,
        fingerprint=digest,
        title=title(scrubbed),
        level=level if isinstance(level, str) else "error",
        release=str(scrubbed.get("release") or ""),
        event=scrubbed,
        first_seen=now,
        last_seen=now,
    )
    prune(now)
    return report, True
