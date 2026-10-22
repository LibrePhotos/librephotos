"""File-name date patterns of a custom date rule (#2272).

A user writes where the date sits in a file name as a pattern such as
``YYYY-MM-DD HH.mm.ss`` instead of a regular expression. Each placeholder is a
fixed run of digits and every other character stands for itself, so the
expression built from a pattern has nothing to backtrack over: a search costs
at most the length of the name times the length of the pattern, whatever the
user typed. A user's own regular expression could take the scan worker down
for every user (``(a+)+$`` against a long path), and Python's ``re`` has no
timeout.

The web app reads the same syntax (``dateRuleForm.ts``) for its preview.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

# Placeholder -> the part of the date it holds and its number of digits.
PLACEHOLDERS: dict[str, tuple[str, int]] = {
    "YYYY": ("year", 4),
    "MM": ("month", 2),
    "DD": ("day", 2),
    "HH": ("hour", 2),
    "mm": ("minute", 2),
    "ss": ("second", 2),
}
# "?" stands for any one character (a separator that varies).
ANY_CHARACTER = "?"
REQUIRED_PARTS = ("year", "month", "day")
MAX_PATTERN_LENGTH = 64

# Longest placeholder first, so "YYYY" is not read as two "YY".
_TOKEN = re.compile(
    "|".join(
        re.escape(token)
        for token in sorted([*PLACEHOLDERS, ANY_CHARACTER], key=len, reverse=True)
    )
)


class DatePatternError(ValueError):
    """Why a pattern cannot be used, in words for the person who wrote it."""


@dataclass(frozen=True)
class DatePattern:
    """A pattern as the date rules run it: the expression and, for each of
    its groups in order, the date part it holds."""

    regexp: re.Pattern[str]
    group_mapping: list[str]


def _pieces(pattern: str) -> list[str]:
    """The placeholders and single literal characters of ``pattern``, in order."""
    pieces: list[str] = []
    position = 0
    while position < len(pattern):
        token = _TOKEN.match(pattern, position)
        piece = token.group(0) if token else pattern[position]
        pieces.append(piece)
        position += len(piece)
    return pieces


def _check_parts(parts: list[str]) -> None:
    for part in REQUIRED_PARTS:
        if part not in parts:
            raise DatePatternError(
                "The pattern needs the year (YYYY), month (MM) and day (DD)."
            )
    repeated = sorted({part for part in parts if parts.count(part) > 1})
    if repeated:
        raise DatePatternError(f"The pattern holds the {repeated[0]} twice.")


def compile_date_pattern(pattern: str) -> DatePattern:
    """``pattern`` as an expression; ``DatePatternError`` when it is not one
    a rule can use."""
    if not pattern or len(pattern) > MAX_PATTERN_LENGTH:
        raise DatePatternError(
            f"The pattern must be 1 to {MAX_PATTERN_LENGTH} characters long."
        )
    expression: list[str] = []
    parts: list[str] = []
    for piece in _pieces(pattern):
        if piece in PLACEHOLDERS:
            part, digits = PLACEHOLDERS[piece]
            parts.append(part)
            expression.append(rf"(\d{{{digits}}})")
        elif piece == ANY_CHARACTER:
            expression.append(".")
        else:
            expression.append(re.escape(piece))
    _check_parts(parts)
    return DatePattern(re.compile("".join(expression)), parts)
