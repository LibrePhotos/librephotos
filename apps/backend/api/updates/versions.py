"""Which release tags are versions, and which of two is newer (#2311).

The tags use two schemes: ``2026wNN`` up to 2026w25, then semver from 1.0.0.
Every semver release is newer than every weekly one. Anything else (``dev``,
an empty tag, ``windows-wheels-2026.09.16``, a pre-release such as
``1.5.0-rc1``) is not a version: it is never compared and never offered.
"""

from __future__ import annotations

import re

# Weekly tags sort before semver ones: the first element is the scheme.
_WEEKLY_SCHEME = 0
_SEMVER_SCHEME = 1

# [0-9], not \d: \d also matches other scripts' digits ("٩.٠.٠").
_SEMVER = re.compile(r"v?([0-9]+)\.([0-9]+)\.([0-9]+)")
_WEEKLY = re.compile(r"([0-9]{4})w([0-9]{1,2})")

Version = tuple[int, int, int, int]


def parse_version(tag: str) -> Version | None:
    """The tag as a sortable version, or None when it is not a release version."""
    text = tag.strip()
    semver = _SEMVER.fullmatch(text)
    if semver is not None:
        major, minor, patch = (int(part) for part in semver.groups())
        return (_SEMVER_SCHEME, major, minor, patch)
    weekly = _WEEKLY.fullmatch(text)
    if weekly is not None:
        return (_WEEKLY_SCHEME, int(weekly.group(1)), int(weekly.group(2)), 0)
    return None


def is_newer(candidate: str, current: str) -> bool:
    """Whether release ``candidate`` is newer than ``current``; False when
    either is not a version."""
    new, old = parse_version(candidate), parse_version(current)
    return new is not None and old is not None and new > old
