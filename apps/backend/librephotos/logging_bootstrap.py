"""Single source of truth for how LibrePhotos configures logging.

Where the log goes, what a line looks like and how it rotates is decided here
and nowhere else, so the Django settings, the management commands and the
standalone service processes cannot drift apart.

This module must stay importable *without* Django: image_similarity/main.py and
the service/*/main.py processes are plain Python and never load settings, and
they produce records of the same shape (configure_standalone, reached through
service._common.logger).
"""

import logging
import logging.config
import os
import sys
from collections.abc import Iterable
from typing import Any

from librephotos import env

# Renamed to librephotos.log in a follow-up PR. Named once, here, so that rename
# is a one-line change instead of a grep across settings, services and docs.
LOG_FILENAME = "ownphotos.log"

# The name dictConfig gives the rotating file handler. get_file_handler resolves
# the live handler object by this name, so api.apps can apply the constance
# rotation settings to it.
LOG_FILE_HANDLER_NAME = "librephotos_file"
CONSOLE_HANDLER_NAME = "console"
FORMATTER_NAME = "librephotos"

DEFAULT_LOG_MAX_BYTES = 200 * 1024 * 1024  # 200 MB
DEFAULT_LOG_BACKUP_COUNT = 10

DEFAULT_LOGS_ROOT = "/logs/"
DEFAULT_LOG_LEVEL = "INFO"
VALID_LEVELS = ("CRITICAL", "ERROR", "WARNING", "INFO", "DEBUG")

# Keep this format string exactly as it is. People grep and parse ownphotos.log,
# and reshaping a line breaks whatever they built on top of it. It changes
# together with the file rename, so their parsers have to be updated once rather
# than twice.
LOG_FORMAT = (
    "%(asctime)s : %(filename)s : %(funcName)s : %(lineno)s : "
    "%(levelname)s : %(message)s"
)

# Third-party loggers that would otherwise drown the file. They are floors, not
# fixed levels: LOG_LEVEL=DEBUG still leaves django-q2 at INFO (it logs a line
# per task, and there is one task per photo), while LOG_LEVEL=ERROR pushes them
# down to ERROR with everything else - a floor should never make a logger more
# verbose than the level the admin asked for.
THIRD_PARTY_LEVELS = {
    "django_q": "INFO",
    "urllib3": "WARNING",
    "PIL": "INFO",
    "matplotlib": "WARNING",
    "asyncio": "WARNING",
    "django.db.backends": "WARNING",
    # libvips narrates every decode and resize at INFO, ~35 lines per photo.
    "pyvips": "WARNING",
}

# Messages from before logging is configured: the settings modules and
# librephotos.secret_key run while the configuration is still being built, when
# there is no handler to report through yet. They are held here, with their
# level, until someone can log them properly; see api.apps.ApiConfig.ready and
# service._common.serve_forever.
_deferred: list[tuple[int, str]] = []


def defer(level: int, message: str) -> None:
    """Hold ``message`` until logging is configured, then log it at ``level``.

    The settings modules use this instead of print(): a print there lands on the
    stdout of every process that imports them, management commands included,
    before logging exists.
    """
    _deferred.append((level, message))


def defer_warning(message: str) -> None:
    """``defer(logging.WARNING, message)``."""
    defer(logging.WARNING, message)


def take_deferred() -> list[tuple[int, str]]:
    """Return and clear the ``(level, message)`` pairs recorded before logging
    was configured.

    That includes the environment values librephotos.env could not read while
    the settings were being imported, as warnings.
    """
    records = [*_deferred, *((logging.WARNING, m) for m in env.take_warnings())]
    _deferred.clear()
    return records


def resolve_level(raw: str | None = None) -> str:
    """Validate a level name, falling back to INFO for anything unrecognised.

    dictConfig raises ValueError on an unknown level, and it does so while the
    settings module is being imported - before a single handler exists - so a
    typo in LOG_LEVEL would take every process down with nothing written
    anywhere explaining why. Fall back and report it once logging works.
    """
    if raw is None:
        raw = env.env_str("LOG_LEVEL")
    level = str(raw).strip().upper()
    if not level:
        return DEFAULT_LOG_LEVEL
    if level not in VALID_LEVELS:
        defer_warning(
            f"unknown LOG_LEVEL {raw!r}, using {DEFAULT_LOG_LEVEL} instead; "
            f"expected one of {', '.join(VALID_LEVELS)}"
        )
        return DEFAULT_LOG_LEVEL
    return level


def resolve_logger_levels(raw: str | None = None) -> dict[str, str]:
    """Parse per-logger level overrides from ``LOG_LEVELS``.

    The format is a comma-separated list of ``logger=LEVEL`` pairs, for
    example ``api.directory_watcher=DEBUG,nextcloud=WARNING``. Every module logs
    through ``logging.getLogger(__name__)``, so a package name covers all of its
    modules. Malformed entries are skipped and reported once logging works, for
    the same reason an unknown LOG_LEVEL is.
    """
    if raw is None:
        raw = env.env_str("LOG_LEVELS")
    levels: dict[str, str] = {}
    for entry in str(raw).split(","):
        entry = entry.strip()
        if not entry:
            continue
        name, sep, level = entry.partition("=")
        name = name.strip()
        level = level.strip().upper()
        if not sep or not name or level not in VALID_LEVELS:
            defer_warning(
                f"ignoring LOG_LEVELS entry {entry!r}; expected logger=LEVEL "
                f"with LEVEL one of {', '.join(VALID_LEVELS)}"
            )
            continue
        levels[name] = level
    return levels


def resolve_to_console(raw: bool | str | None = None) -> bool:
    """Whether to mirror the log to stdout as well as to the file.

    On by default: on Kubernetes the log directory is usually an emptyDir, so
    stdout is the only copy of the log that outlives the pod.
    """
    if raw is None:
        return env.env_flag("LOG_TO_CONSOLE", default=True)
    if isinstance(raw, bool):
        return raw
    return env.parse_flag("LOG_TO_CONSOLE", raw)


def resolve_logs_root(explicit: str | None = None) -> str:
    """Directory the log files live in: the argument, else $BASE_LOGS."""
    if explicit:
        return explicit
    return env.env_str("BASE_LOGS") or DEFAULT_LOGS_ROOT


def ensure_logs_root(path: str) -> str:
    """Create the log directory, or stop with a message that names it.

    Deliberately not the warn-and-continue treatment MPLCONFIGDIR gets in
    production.py: the rotating file handler opens a file in this directory as
    soon as logging is configured, so continuing here only turns a diagnosable
    error into a bare FileNotFoundError from a line that says nothing about the
    BASE_LOGS setting at all.
    """
    try:
        os.makedirs(path, exist_ok=True)
    except OSError as error:
        raise RuntimeError(
            f"could not create the log directory {path}: {error}. "
            "Set the BASE_LOGS environment variable to a directory the backend "
            "may write to, or mount that path into the container."
        ) from error
    if not os.access(path, os.W_OK):
        raise RuntimeError(
            f"the log directory {path} is not writable. Set the BASE_LOGS "
            "environment variable to a directory the backend may write to, or "
            "fix the permissions on that path."
        )
    return path


def _more_restrictive(level_a: str, level_b: str) -> str:
    return (
        level_a if getattr(logging, level_a) >= getattr(logging, level_b) else level_b
    )


def _most_verbose(levels: Iterable[str]) -> str:
    return min(levels, key=lambda name: getattr(logging, name))


def build_logging_config(
    logs_root: str | None = None,
    level: str | None = None,
    to_console: bool = True,
    max_bytes: int = DEFAULT_LOG_MAX_BYTES,
    backup_count: int = DEFAULT_LOG_BACKUP_COUNT,
    filename: str | None = None,
    logger_levels: dict[str, str] | None = None,
) -> dict[str, Any]:
    """Build the dictConfig every LibrePhotos process is configured from.

    The rotating file handler hangs off the *root* logger, so third-party
    libraries end up in the same file as our own records instead of vanishing.
    ``max_bytes``/``backup_count`` are the boot-time defaults; the constance
    settings are applied on top of the live handler once the database is
    reachable (see api.apps.reconfigure_logging).

    ``logger_levels`` (default: parsed from ``LOG_LEVELS``) sets individual
    loggers above or below ``level``. The handlers filter at the most verbose
    level in play, so ``api.directory_watcher=DEBUG`` actually reaches the file
    while everything else stays at ``level``; without overrides the handlers sit
    at ``level`` exactly as before.
    """
    level = resolve_level(level)
    if logger_levels is None:
        logger_levels = resolve_logger_levels()
    handler_level = _most_verbose([level, *logger_levels.values()])
    log_file = os.path.join(resolve_logs_root(logs_root), filename or LOG_FILENAME)

    handlers = {
        LOG_FILE_HANDLER_NAME: {
            # ConcurrentRotatingFileHandler rather than the stdlib
            # RotatingFileHandler: uvicorn workers and django-q2 workers write
            # to this file at the same time, and plain rotation truncates it
            # under the other processes (bug #1765).
            "class": "concurrent_log_handler.ConcurrentRotatingFileHandler",
            "filename": log_file,
            "maxBytes": max_bytes,
            "backupCount": backup_count,
            "formatter": FORMATTER_NAME,
            "level": handler_level,
        },
    }
    root_handlers = [LOG_FILE_HANDLER_NAME]

    if to_console:
        handlers[CONSOLE_HANDLER_NAME] = {
            "class": "logging.StreamHandler",
            "formatter": FORMATTER_NAME,
            "level": handler_level,
        }
        root_handlers.append(CONSOLE_HANDLER_NAME)

    loggers = {
        name: {"level": _more_restrictive(level, floor)}
        for name, floor in THIRD_PARTY_LEVELS.items()
    }
    # An explicit override beats a third-party floor: whoever sets
    # LOG_LEVELS=django_q=DEBUG is asking for exactly that chatter.
    loggers.update({name: {"level": lvl} for name, lvl in logger_levels.items()})

    return {
        "version": 1,
        # Django applies its own DEFAULT_LOGGING first and libraries create
        # loggers at import time; disabling them would silence both.
        "disable_existing_loggers": False,
        "formatters": {FORMATTER_NAME: {"format": LOG_FORMAT}},
        "handlers": handlers,
        "loggers": loggers,
        "root": {"handlers": root_handlers, "level": level},
    }


class LoggingNotConfiguredError(RuntimeError):
    """Raised when the rotating file handler is missing from the root logger."""


def get_file_handler() -> logging.Handler | None:
    """Return the live rotating file handler installed by the LOGGING config.

    The handler is owned by the dictConfig in settings.LOGGING - this only looks
    it up, by the name dictConfig gave it - so there is exactly one file handler
    per process. Resolve it on every use: dictConfig hands out a new handler
    object each time it runs.
    """
    for handler in logging.getLogger().handlers:
        if getattr(handler, "name", None) == LOG_FILE_HANDLER_NAME:
            return handler
    return None


def require_file_handler() -> logging.Handler:
    """``get_file_handler()``, raising ``LoggingNotConfiguredError`` when it is
    missing."""
    handler = get_file_handler()
    if handler is None:
        raise LoggingNotConfiguredError(
            f"no {LOG_FILE_HANDLER_NAME!r} handler on the root logger; the "
            "LOGGING configuration did not install one, so the log rotation "
            "settings have nothing to apply to"
        )
    return handler


def configure_standalone(logger_name: str, level: str | None = None) -> logging.Logger:
    """The logger of a process that never loads Django (a sidecar), set up to
    write to stdout only.

    Records get the backend's format and LOG_LEVEL (or the logger's LOG_LEVELS
    entry); stdout is where api.runtime.supervisor leaves the sidecars' output, so it ends
    up in the container log. Only the named logger is touched, never the root:
    the sidecar modules are imported by the Django test process as well, whose
    logging the settings configured. A second call returns the same logger
    without adding another handler. service._common.logger is the one caller.
    """
    logger = logging.getLogger(logger_name)
    if any(h.get_name() == CONSOLE_HANDLER_NAME for h in logger.handlers):
        return logger
    handler = logging.StreamHandler(sys.stdout)
    handler.set_name(CONSOLE_HANDLER_NAME)
    handler.setFormatter(logging.Formatter(LOG_FORMAT))
    logger.addHandler(handler)
    logger.setLevel(resolve_logger_levels().get(logger_name) or resolve_level(level))
    # Nothing above it would write the record to stdout a second time in the
    # sidecar; in the test process it keeps the record out of the log file.
    logger.propagate = False
    return logger
