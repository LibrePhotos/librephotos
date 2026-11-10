"""IANA time zones by name: the list users pick from, and the zone for a name.

The names are the pinned ``tzdata`` package's, without ``Factory`` (not a
place): the list ``pytz.all_timezones`` gave up to 1.7.0, so stored names and
the zone picker are unchanged.
"""

from datetime import UTC, datetime, tzinfo
from importlib.resources import files
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

ALL_TIME_ZONES: tuple[str, ...] = tuple(
    sorted(
        set(files("tzdata").joinpath("zones").read_text(encoding="utf-8").split())
        - {"Factory"}
    )
)
ALL_TIME_ZONES_SET = frozenset(ALL_TIME_ZONES)
_BY_LOWER_NAME = {name.lower(): name for name in ALL_TIME_ZONES}


def time_zone(name: object) -> tzinfo:
    """The zone ``name`` names, in any letter case (``"europe/berlin"``).

    Any spelling of ``UTC`` is ``datetime.UTC``. Raises
    ``ZoneInfoNotFoundError`` (a ``KeyError``, as pytz's
    ``UnknownTimeZoneError`` was) for anything that is not a name in
    ``ALL_TIME_ZONES``, with the name as the message.
    """
    if not isinstance(name, str):
        raise ZoneInfoNotFoundError(name)
    if name.upper() == "UTC":
        return UTC
    # pytz's spelling of + and - in names that are also file names.
    key = name.replace("_plus_", "+").replace("_minus_", "-").lower()
    canonical = _BY_LOWER_NAME.get(key)
    if canonical is None:
        raise ZoneInfoNotFoundError(name)
    return ZoneInfo(canonical)


def localize(wall_clock: datetime, zone: tzinfo) -> datetime:
    """``wall_clock`` (naive) read as a time in ``zone``.

    As pytz's ``zone.localize(wall_clock)`` read it: a time that happens
    twice (clocks going back) is the standard-time one, else the later one;
    a time that never happens (clocks going forward) is read at the offset
    from before the change.
    """
    first = wall_clock.replace(tzinfo=zone, fold=0)
    second = wall_clock.replace(tzinfo=zone, fold=1)
    if first.utcoffset() == second.utcoffset():
        return first
    if first.astimezone(UTC).astimezone(zone).replace(tzinfo=None) != wall_clock:
        return first  # skipped: fold=0 is the offset from before the change
    standard = [candidate for candidate in (first, second) if not candidate.dst()]
    return standard[0] if len(standard) == 1 else second
