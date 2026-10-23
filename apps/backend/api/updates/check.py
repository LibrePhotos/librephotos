"""The daily check for a newer LibrePhotos release (#2311).

Once a day (a django-q schedule, ``start_cleaning_service``) the backend asks
GitHub for the repository's releases: one plain, unauthenticated GET, with no
cookie, token or anything else about this server. It keeps the newest release
in ``UPDATE_CHECK_RESULT``; the Admin page, the sidebar and the Windows tray
read that, never GitHub.

"Newest" is worked out here, not taken from GitHub's "latest" flag: a release
is created with ``make_latest=false`` and only marked latest once its Windows
zip is attached, hours later. Drafts, pre-releases and tags that are not
versions are left out, and the Windows app is offered only a release whose
assets include its zip, so it is never told to update while the zip builds.

The check is off while the ``UPDATE_CHECK`` site setting is off, for good while
the ``UPDATE_CHECK`` environment variable is false (``UPDATE_CHECK_ALLOWED``),
and for development builds (``dev``, no tag): they have no version to compare.
A failed check is stored with its reason and never raised; the release found
before stays known.
"""

from __future__ import annotations

import dataclasses
import datetime
import json
import logging
from typing import TypedDict

import requests
from constance import config as site_config
from django.conf import settings
from django.utils import timezone

from .install import InstallState, install_state
from .versions import Version, is_newer, parse_version

logger = logging.getLogger(__name__)

# The django-q schedule's function (start_cleaning_service).
SCHEDULED_CHECK = "api.updates.check.check_for_updates"
RELEASES_URL = "https://api.github.com/repos/LibrePhotos/librephotos/releases"
# Enough to reach past the pre-releases (windows-wheels-*) to the newest release.
RELEASES_PER_PAGE = 30
REQUEST_TIMEOUT_SECONDS = 10
# The asset the Windows app updates from (scripts/build_standalone.py --zip).
WINDOWS_ASSET = "librephotos-windows-x64.zip"

WINDOWS, DOCKER, SOURCE = "windows", "docker", "source"
_DOCS = "https://docs.librephotos.com/docs/installation/"
HOW_TO_UPDATE_URLS = {
    WINDOWS: _DOCS + "windows-standalone#updating",
    DOCKER: _DOCS + "upgrading",
    SOURCE: _DOCS + "upgrading",
}
# How long closing the Update available card hides it.
SNOOZE = datetime.timedelta(days=7)

# What the status says, for the line under the site setting.
LOCKED = "locked"
OFF = "off"
DEVELOPMENT = "development"
NOT_CHECKED = "not_checked"
FAILED = "failed"
UP_TO_DATE = "up_to_date"
AVAILABLE = "available"
SKIPPED = "skipped"


@dataclasses.dataclass(frozen=True)
class CheckResult:
    """What the last check found, as ``UPDATE_CHECK_RESULT`` keeps it."""

    checked_at: str
    latest: str | None = None
    release_url: str | None = None
    published_at: str | None = None
    error: str | None = None

    def to_json(self) -> str:
        return json.dumps(dataclasses.asdict(self))

    @classmethod
    def from_json(cls, text: str) -> CheckResult | None:
        """The stored result, or None before the first check (or when unreadable)."""
        try:
            data = json.loads(text)
            return cls(**data) if isinstance(data, dict) else None
        except ValueError, TypeError:
            return None


class CheckFailedError(Exception):
    """GitHub did not answer with a list of releases; ``code`` says how."""

    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


class UpdateStatus(TypedDict):
    """What ``GET /api/updates/`` answers (admins only)."""

    enabled: bool
    locked: bool
    status: str
    current: str
    latest: str | None
    update_available: bool
    notice: bool
    release_url: str | None
    published_at: datetime.datetime | None
    checked_at: datetime.datetime | None
    error: str | None
    install_type: str
    how_to_update_url: str
    skipped_release: str | None
    snoozed_until: datetime.datetime | None
    install: InstallState


def current_version() -> str:
    """The release this server runs, as its build reports it ("" from source)."""
    return settings.IMAGE_TAG.strip()


def install_type() -> str:
    """windows, docker or source: which update steps apply."""
    return settings.INSTALL_TYPE


def update_check_locked() -> bool:
    """The environment turned the check off; the site setting cannot."""
    return not settings.UPDATE_CHECK_ALLOWED


def update_check_enabled() -> bool:
    return not update_check_locked() and bool(site_config.UPDATE_CHECK)


def _has_windows_asset(item: dict[str, object]) -> bool:
    assets = item.get("assets")
    return isinstance(assets, list) and any(
        isinstance(asset, dict) and asset.get("name") == WINDOWS_ASSET
        for asset in assets
    )


def _offered_release(item: object, windows: bool) -> CheckResult | None:
    """A release from GitHub's list as this server may be offered it, or None."""
    if not isinstance(item, dict) or item.get("draft") or item.get("prerelease"):
        return None
    tag = item.get("tag_name")
    if not isinstance(tag, str) or parse_version(tag) is None:
        return None
    if windows and not _has_windows_asset(item):
        return None
    url, published = item.get("html_url"), item.get("published_at")
    return CheckResult(
        checked_at="",
        latest=tag.strip(),
        release_url=url if isinstance(url, str) else None,
        published_at=published if isinstance(published, str) else None,
    )


def newest_release(releases: list[object], windows: bool) -> CheckResult | None:
    """The newest release this server may be offered, by version, not by date."""
    offered = [
        release
        for release in (_offered_release(item, windows) for item in releases)
        if release is not None
    ]
    return max(offered, key=_release_version, default=None)


def _release_version(release: CheckResult) -> Version:
    # _offered_release kept only releases whose tag is a version.
    return parse_version(release.latest or "") or (0, 0, 0, 0)


def fetch_releases(session: requests.Session) -> list[object]:
    """GitHub's newest releases, raw. Raises CheckFailedError."""
    try:
        response = session.get(
            RELEASES_URL,
            params={"per_page": RELEASES_PER_PAGE},
            headers={"Accept": "application/vnd.github+json"},
            timeout=REQUEST_TIMEOUT_SECONDS,
        )
    except requests.Timeout as error:
        raise CheckFailedError("timeout") from error
    except requests.RequestException as error:
        raise CheckFailedError("unreachable") from error
    if not response.ok:
        raise CheckFailedError(f"http_{response.status_code}")
    try:
        releases = response.json()
    except ValueError as error:
        raise CheckFailedError("bad_response") from error
    if not isinstance(releases, list):
        raise CheckFailedError("bad_response")
    return releases


def stored_result() -> CheckResult | None:
    return CheckResult.from_json(str(site_config.UPDATE_CHECK_RESULT))


def _run_check(session: requests.Session) -> CheckResult:
    checked_at = timezone.now().isoformat()
    try:
        releases = fetch_releases(session)
    except CheckFailedError as failure:
        logger.warning("Update check: GitHub did not answer (%s)", failure.code)
        previous = stored_result() or CheckResult(checked_at=checked_at)
        return dataclasses.replace(previous, checked_at=checked_at, error=failure.code)
    newest = newest_release(releases, windows=install_type() == WINDOWS)
    if newest is None:
        return CheckResult(checked_at=checked_at)
    return dataclasses.replace(newest, checked_at=checked_at)


def _run_check_in_new_session() -> CheckResult:
    with requests.Session() as session:
        return _run_check(session)


def check_for_updates(session: requests.Session | None = None) -> UpdateStatus:
    """Ask GitHub for the newest release now and keep the answer.

    The daily schedule's task and the tray's Check for updates. Sends nothing
    while the check is off or this is a development build.
    """
    if update_check_enabled() and parse_version(current_version()) is not None:
        result = _run_check(session) if session else _run_check_in_new_session()
        site_config.UPDATE_CHECK_RESULT = result.to_json()
        if result.error is None:
            logger.info("Update check: newest release %s", result.latest or "none")
    return update_status()


def _parse_time(text: str | None) -> datetime.datetime | None:
    if not text:
        return None
    try:
        return datetime.datetime.fromisoformat(text)
    except ValueError:
        return None


def _blocked_state(enabled: bool, current: str) -> str | None:
    """Why no check runs, or None when it does."""
    if update_check_locked():
        return LOCKED
    if not enabled:
        return OFF
    return DEVELOPMENT if parse_version(current) is None else None


def _result_state(result: CheckResult | None, available: bool, skipped: bool) -> str:
    """What the last check found."""
    if result is None:
        return NOT_CHECKED
    if result.error is not None:
        return FAILED
    if not available:
        return UP_TO_DATE
    return SKIPPED if skipped else AVAILABLE


def update_status(now: datetime.datetime | None = None) -> UpdateStatus:
    """The update check as admins see it.

    ``update_available``: a newer release is known. ``notice``: the Admin page
    card and the sidebar dot show it, unless it was skipped or the card was
    closed less than a week ago.
    """
    now = now or timezone.now()
    enabled = update_check_enabled()
    current = current_version()
    result = stored_result() if enabled else None
    latest = result.latest if result is not None else None
    available = latest is not None and is_newer(latest, current)
    skipped_release = str(site_config.UPDATE_CHECK_SKIPPED_RELEASE) or None
    snoozed_until = _parse_time(str(site_config.UPDATE_CHECK_SNOOZED_UNTIL))
    skipped = available and latest == skipped_release
    snoozed = snoozed_until is not None and snoozed_until > now
    kind = install_type()
    return UpdateStatus(
        enabled=enabled,
        locked=update_check_locked(),
        status=_blocked_state(enabled, current)
        or _result_state(result, available, skipped),
        current=current,
        latest=latest,
        update_available=available,
        notice=available and not skipped and not snoozed,
        release_url=result.release_url if result is not None else None,
        published_at=_parse_time(result.published_at if result else None),
        checked_at=_parse_time(result.checked_at if result else None),
        error=result.error if result is not None else None,
        install_type=kind,
        how_to_update_url=HOW_TO_UPDATE_URLS.get(kind, HOW_TO_UPDATE_URLS[SOURCE]),
        skipped_release=skipped_release,
        snoozed_until=snoozed_until if snoozed else None,
        install=install_state(latest if available else None),
    )


def skip_release(version: str) -> None:
    """Stop telling admins about ``version``; "" shows the newest release again."""
    site_config.UPDATE_CHECK_SKIPPED_RELEASE = version


def snooze_notice(now: datetime.datetime | None = None) -> None:
    """Hide the Update available card for a week."""
    site_config.UPDATE_CHECK_SNOOZED_UNTIL = (
        (now or timezone.now()) + SNOOZE
    ).isoformat()
