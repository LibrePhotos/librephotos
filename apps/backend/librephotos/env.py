"""The one place LibrePhotos reads its environment.

The Django process reads configuration from ``django.conf.settings``; the
settings modules fill it in through these helpers. The few processes that never
load settings - the entry points, ``logging_bootstrap`` and the sidecars under
``service/`` and ``image_similarity/`` - read through them too, so every
variable is parsed the same way wherever it is read. Ruff's TID251 ban on
``os.environ`` / ``os.getenv`` keeps it that way; ``pyproject.toml`` lists the
files that may still touch the environment directly.

This module must stay importable *without* Django, because the sidecars import
it. That is why a bad value raises ``EnvError``, a plain ``ValueError``, rather
than Django's ``ImproperlyConfigured``: either way the process stops with a
message that names the variable.
"""

import logging
import os
from collections.abc import Iterable
from typing import overload

# The spellings an on/off switch accepts, compared after strip() and lower().
ON_VALUES = frozenset({"true", "1", "yes", "on"})
OFF_VALUES = frozenset({"false", "0", "no", "off"})

logger = logging.getLogger(__name__)

# Complaints noticed before logging is configured (the settings modules run
# before any handler exists). logging_bootstrap.take_deferred_warnings drains
# them together with its own, once there is somewhere to log them.
_deferred_warnings: list[str] = []


class EnvError(ValueError):
    """An environment variable holds a value its parser cannot read."""


def take_warnings() -> list[str]:
    """Return and clear the warnings recorded before logging was configured."""
    messages = list(_deferred_warnings)
    _deferred_warnings.clear()
    return messages


def _warn(message: str) -> None:
    if logging.getLogger().handlers:
        logger.warning("%s", message)
    else:
        _deferred_warnings.append(message)


def _flag_word(raw: str) -> bool | None:
    """True or False for a recognised spelling, None for anything else."""
    value = raw.strip().lower()
    if value in ON_VALUES:
        return True
    if value in OFF_VALUES:
        return False
    return None


@overload
def env_str(name: str, default: str = "") -> str: ...
@overload
def env_str(name: str, default: None) -> str | None: ...
def env_str(name: str, default: str | None = "") -> str | None:
    """The raw value of ``name``, or ``default`` when it is unset.

    A blank value is returned as it is; callers for which blank means "use the
    default" write ``env_str(NAME) or default``. Pass ``default=None`` to tell
    unset apart from blank.
    """
    return os.environ.get(name, default)


def parse_flag(name: str, raw: str, *, empty: bool = False) -> bool:
    """Read an on/off value that came from ``name``.

    ``true``/``1``/``yes``/``on`` are on and ``false``/``0``/``no``/``off`` are
    off, in any case. A blank value means ``empty``. Anything else is off, as
    it always was, but now says so in the log: a typo in a switch should not
    pass unnoticed.
    """
    if not raw.strip():
        return empty
    value = _flag_word(raw)
    if value is None:
        _warn(
            f"{name}={raw!r} is not an on/off value, so it counts as off. "
            "Use true, 1, yes or on to switch it on, false, 0, no or off to "
            "switch it off."
        )
        return False
    return value


def env_flag(name: str, default: bool, *, empty: bool = False) -> bool:
    """An on/off switch: unset means ``default``, blank means ``empty``.

    ``FEATURE_X=`` switches a feature off, so ``empty`` is off unless a caller
    says otherwise. See ``parse_flag`` for the accepted spellings.
    """
    raw = os.environ.get(name)
    if raw is None:
        return default
    return parse_flag(name, raw, empty=empty)


def env_optional_flag(name: str) -> bool | None:
    """An on/off switch whose default the caller works out itself.

    Returns None when ``name`` is unset, blank or not an on/off value (the last
    one with a warning), so the caller can fall back to a default that depends
    on more than the variable.
    """
    raw = os.environ.get(name)
    if raw is None or not raw.strip():
        return None
    value = _flag_word(raw)
    if value is None:
        _warn(f"{name}={raw!r} is not an on/off value, so the default applies.")
    return value


@overload
def env_int(name: str, default: int) -> int: ...
@overload
def env_int(name: str, default: None) -> int | None: ...
def env_int(name: str, default: int | None) -> int | None:
    """A whole number; unset or blank means ``default``."""
    value = os.environ.get(name, "").strip()
    if not value:
        return default
    try:
        return int(value)
    except ValueError:
        raise EnvError(f"{name} must be a whole number, got {value!r}") from None


def env_float(name: str, default: float) -> float:
    """A number, fractions allowed; unset or blank means ``default``."""
    value = os.environ.get(name, "").strip()
    if not value:
        return default
    try:
        return float(value)
    except ValueError:
        raise EnvError(f"{name} must be a number, got {value!r}") from None


def env_list(name: str, default: Iterable[str] = ()) -> list[str]:
    """A comma-separated list, entries stripped and blank ones dropped.

    Unset means ``default``; set but blank means an empty list.
    """
    value = os.environ.get(name)
    if value is None:
        return list(default)
    return [item.strip() for item in value.split(",") if item.strip()]


def export(name: str, value: str) -> None:
    """Set ``name`` for this process and every child it starts afterwards."""
    os.environ[name] = value
