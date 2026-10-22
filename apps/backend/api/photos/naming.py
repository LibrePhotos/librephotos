"""File and folder names made from a photo's capture date (#2773, #2774).

A pattern is literal text with tokens: ``{year}``, ``{month}``, ``{day}``,
``{hour}``, ``{minute}``, ``{second}`` (the wall clock where the photo was
taken, ``Photo.exif_timestamp``) and, in a file name, ``{name}`` (the main
file's current name without its extension). ``check_name_pattern`` and
``check_folder_pattern`` refuse a pattern that is not safe on every file
system; ``render_name`` and ``render_folder`` fill one in for a photo.

Only ``{name}`` brings text from outside the pattern into a path, so it is
cleaned (``_clean``) before it is used: no separators, no characters Windows
refuses, no ``..``. Every part of the result is checked again
(``_safe_part``), so a name never leaves the folder it is made for.
"""

from __future__ import annotations

import datetime
import os
import re
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from api.models.photo import Photo

#: The tokens of the capture date, in the order a form lists them.
DATE_TOKENS = ("year", "month", "day", "hour", "minute", "second")
#: The token of the main file's current name without its extension.
NAME_TOKEN = "name"

#: The longest pattern a request may send.
MAX_PATTERN_LENGTH = 200
#: The longest name (or folder) a pattern makes, in characters. A file
#: keeps its extension and may get `` (999)``: the whole stays well inside
#: the 255 a file system allows.
MAX_PART_LENGTH = 180
#: The most folder levels a folder pattern makes.
MAX_FOLDER_DEPTH = 6

_TOKEN = re.compile(r"\{([a-z]+)\}")
#: Characters no part of a path may contain: separators, Windows' reserved
#: characters and control characters.
_UNSAFE = re.compile(r'[\\/:*?"<>|\x00-\x1f\x7f]')
#: Names Windows reserves for devices, with or without an extension.
_RESERVED = re.compile(r"^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\..*)?$", re.IGNORECASE)


class InvalidPatternError(ValueError):
    """A pattern that could make an unsafe name; the message says why."""


def _check_tokens(pattern: str, allowed: tuple[str, ...]) -> str:
    """``pattern`` with its tokens taken out; unknown tokens and stray braces raise."""
    for token in _TOKEN.findall(pattern):
        if token not in allowed:
            raise InvalidPatternError(f"{{{token}}} is not a token.")
    literal = _TOKEN.sub("", pattern)
    if "{" in literal or "}" in literal:
        raise InvalidPatternError("A brace that is not part of a token.")
    return literal


def _check_part(part: str) -> None:
    """Refuse one part of a pattern (a name, or one folder level)."""
    if not part.strip():
        raise InvalidPatternError("A name or folder in the pattern is empty.")
    if part.startswith("."):
        raise InvalidPatternError('A name cannot start with ".".')
    if _UNSAFE.search(_TOKEN.sub("", part)):
        raise InvalidPatternError(
            'A name cannot contain \\ / : * ? " < > | or control characters.'
        )


def _check_length(pattern: str) -> None:
    if not pattern.strip():
        raise InvalidPatternError("The pattern is empty.")
    if len(pattern) > MAX_PATTERN_LENGTH:
        raise InvalidPatternError(
            f"The pattern is longer than {MAX_PATTERN_LENGTH} characters."
        )


def check_name_pattern(pattern: str) -> None:
    """Refuse a file name pattern that is unsafe (``InvalidPatternError``).

    No separator, no ``..``, no character Windows refuses, only known
    tokens, and not longer than ``MAX_PATTERN_LENGTH``.
    """
    _check_length(pattern)
    _check_tokens(pattern, (*DATE_TOKENS, NAME_TOKEN))
    _check_part(pattern)


def check_folder_pattern(pattern: str) -> None:
    """Refuse a folder pattern (``{year}/{month}``) that is unsafe.

    ``/`` separates folder levels; each level is checked as a name is. Only
    the date tokens: a folder per file name is not a sort. Absolute paths,
    ``..`` and empty levels are refused.
    """
    _check_length(pattern)
    _check_tokens(pattern, DATE_TOKENS)
    parts = pattern.split("/")
    if len(parts) > MAX_FOLDER_DEPTH:
        raise InvalidPatternError(
            f"The pattern has more than {MAX_FOLDER_DEPTH} folder levels."
        )
    for part in parts:
        _check_part(part)


def uses_date(pattern: str) -> bool:
    """Whether ``pattern`` needs the photo's capture date."""
    return any(token in DATE_TOKENS for token in _TOKEN.findall(pattern))


def capture_wall_clock(photo: Photo) -> datetime.datetime | None:
    """The wall clock where ``photo`` was taken, or None for an undated photo."""
    timestamp = photo.exif_timestamp
    if timestamp is None:
        return None
    # Stored as the wall clock tagged UTC (``Photo.exif_timestamp``).
    if timestamp.tzinfo is not None:
        timestamp = timestamp.astimezone(datetime.UTC)
    return timestamp.replace(tzinfo=None)


def _date_values(when: datetime.datetime) -> dict[str, str]:
    return {
        "year": f"{when.year:04d}",
        "month": f"{when.month:02d}",
        "day": f"{when.day:02d}",
        "hour": f"{when.hour:02d}",
        "minute": f"{when.minute:02d}",
        "second": f"{when.second:02d}",
    }


def _clean(value: str) -> str:
    """A file name's text made safe to put into another name."""
    return _UNSAFE.sub("_", value)


def _safe_part(part: str) -> str:
    """One rendered part, shortened and made safe on every file system.

    Windows drops trailing dots and spaces and reserves device names; a
    leading dot would hide the file from the scan, and ``..`` would climb.
    """
    part = part[:MAX_PART_LENGTH].rstrip(". ").strip()
    part = part.lstrip(".")
    if not part:
        return "_"
    if _RESERVED.match(part):
        return f"_{part}"
    return part


def _fill(pattern: str, values: dict[str, str]) -> str:
    return _TOKEN.sub(lambda match: values[match.group(1)], pattern)


def _values(pattern: str, photo: Photo) -> dict[str, str] | None:
    """The token values for ``photo``; None when the pattern needs a date it lacks."""
    values: dict[str, str] = {}
    if uses_date(pattern):
        when = capture_wall_clock(photo)
        if when is None:
            return None
        values.update(_date_values(when))
    if photo.main_file is not None:
        stem = os.path.splitext(os.path.basename(photo.main_file.path))[0]
        values[NAME_TOKEN] = _clean(stem)
    else:
        values[NAME_TOKEN] = ""
    return values


def render_name(pattern: str, photo: Photo) -> str | None:
    """The new name (without extension) ``pattern`` gives ``photo``.

    None for an undated photo when the pattern uses the date. ``pattern``
    passed ``check_name_pattern``.
    """
    values = _values(pattern, photo)
    if values is None:
        return None
    return _safe_part(_fill(pattern, values))


def render_folder(pattern: str, photo: Photo) -> list[str] | None:
    """The folder levels ``pattern`` gives ``photo`` (``["2025", "06"]``).

    None for an undated photo. ``pattern`` passed ``check_folder_pattern``.
    """
    values = _values(pattern, photo)
    if values is None:
        return None
    return [_safe_part(_fill(part, values)) for part in pattern.split("/")]
