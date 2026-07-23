"""Single source of truth for how LibrePhotos configures logging.

Where the log goes, what a line looks like and how it rotates is decided here
and nowhere else, so the Django settings, the management commands and the
standalone service processes cannot drift apart.

This module must stay importable *without* Django: image_similarity/main.py and
the service/*/main.py processes are plain Python and never load settings, and
they are supposed to produce records of the same shape.
"""

import logging
import logging.config
import os

# Renamed to librephotos.log in a follow-up PR. Named once, here, so that rename
# is a one-line change instead of a grep across settings, services and docs.
LOG_FILENAME = "ownphotos.log"

# The name dictConfig gives the rotating file handler. api.util resolves the
# live handler object by this name in order to apply the constance rotation
# settings to it, so the two must agree.
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
}

# Problems noticed while the configuration is still being built - at that point
# there is no handler to report them through, and the settings module is halfway
# through its import. They are held here until someone can log them properly;
# see api.apps.ApiConfig.ready and configure_standalone.
_deferred_warnings: list[str] = []


def take_deferred_warnings() -> list[str]:
    """Return and clear the warnings recorded before logging was configured."""
    messages = list(_deferred_warnings)
    _deferred_warnings.clear()
    return messages


def resolve_level(raw=None) -> str:
    """Validate a level name, falling back to INFO for anything unrecognised.

    dictConfig raises ValueError on an unknown level, and it does so while the
    settings module is being imported - before a single handler exists - so a
    typo in LOG_LEVEL would take every process down with nothing written
    anywhere explaining why. Fall back and report it once logging works.
    """
    if raw is None:
        raw = os.environ.get("LOG_LEVEL", "")
    level = str(raw).strip().upper()
    if not level:
        return DEFAULT_LOG_LEVEL
    if level not in VALID_LEVELS:
        _deferred_warnings.append(
            f"unknown LOG_LEVEL {raw!r}, using {DEFAULT_LOG_LEVEL} instead; "
            f"expected one of {', '.join(VALID_LEVELS)}"
        )
        return DEFAULT_LOG_LEVEL
    return level


def resolve_to_console(raw=None) -> bool:
    """Whether to mirror the log to stdout as well as to the file.

    On by default: on Kubernetes the log directory is usually an emptyDir, so
    stdout is the only copy of the log that outlives the pod.
    """
    if raw is None:
        raw = os.environ.get("LOG_TO_CONSOLE")
    if raw is None:
        return True
    if isinstance(raw, bool):
        return raw
    return str(raw).strip().lower() in ("true", "1", "yes", "on")


def resolve_logs_root(explicit=None) -> str:
    """Directory the log files live in: the argument, else $BASE_LOGS."""
    if explicit:
        return explicit
    return os.environ.get("BASE_LOGS") or DEFAULT_LOGS_ROOT


def ensure_logs_root(path) -> str:
    """Create the log directory, or stop with a message that names it.

    Deliberately not the print-and-continue treatment MPLCONFIGDIR gets in
    production.py: secret.key lives in this same directory and the settings
    module writes it a few lines further down, so continuing here only turns a
    diagnosable error into a bare FileNotFoundError from a line that says
    nothing about logs at all.
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


def get_log_file_path(logs_root=None) -> str:
    return os.path.join(resolve_logs_root(logs_root), LOG_FILENAME)


def _more_restrictive(level_a: str, level_b: str) -> str:
    return (
        level_a if getattr(logging, level_a) >= getattr(logging, level_b) else level_b
    )


def build_logging_config(
    logs_root=None,
    level=None,
    to_console=True,
    max_bytes=DEFAULT_LOG_MAX_BYTES,
    backup_count=DEFAULT_LOG_BACKUP_COUNT,
    filename=None,
):
    """Build the dictConfig every LibrePhotos process is configured from.

    The rotating file handler hangs off the *root* logger, so third-party
    libraries end up in the same file as our own records instead of vanishing.
    ``max_bytes``/``backup_count`` are the boot-time defaults; the constance
    settings are applied on top of the live handler once the database is
    reachable (see api.util.reconfigure_logging).
    """
    level = resolve_level(level)
    log_file = os.path.join(resolve_logs_root(logs_root), filename or LOG_FILENAME)

    handlers = {
        LOG_FILE_HANDLER_NAME: {
            # ConcurrentRotatingFileHandler rather than the stdlib
            # RotatingFileHandler: gunicorn workers and django-q2 workers write
            # to this file at the same time, and plain rotation truncates it
            # under the other processes (bug #1765).
            "class": "concurrent_log_handler.ConcurrentRotatingFileHandler",
            "filename": log_file,
            "maxBytes": max_bytes,
            "backupCount": backup_count,
            "formatter": FORMATTER_NAME,
            "level": level,
        },
    }
    root_handlers = [LOG_FILE_HANDLER_NAME]

    if to_console:
        handlers[CONSOLE_HANDLER_NAME] = {
            "class": "logging.StreamHandler",
            "formatter": FORMATTER_NAME,
            "level": level,
        }
        root_handlers.append(CONSOLE_HANDLER_NAME)

    return {
        "version": 1,
        # Django applies its own DEFAULT_LOGGING first and libraries create
        # loggers at import time; disabling them would silence both.
        "disable_existing_loggers": False,
        "formatters": {FORMATTER_NAME: {"format": LOG_FORMAT}},
        "handlers": handlers,
        "loggers": {
            name: {"level": _more_restrictive(level, floor)}
            for name, floor in THIRD_PARTY_LEVELS.items()
        },
        "root": {"handlers": root_handlers, "level": level},
    }


def configure_standalone(
    logger_name,
    filename=None,
    logs_root=None,
    level=None,
    to_console=None,
    max_bytes=DEFAULT_LOG_MAX_BYTES,
    backup_count=DEFAULT_LOG_BACKUP_COUNT,
):
    """Configure logging for a process that never loads Django, and return its
    logger.

    ``filename`` defaults to the shared log file; the services that keep their
    own file (image_similarity, for one) pass their own name and still get the
    same formatter, the same rotation and the same level handling.
    """
    logs_root = resolve_logs_root(logs_root)
    ensure_logs_root(logs_root)
    logging.config.dictConfig(
        build_logging_config(
            logs_root=logs_root,
            level=level,
            to_console=resolve_to_console(to_console),
            max_bytes=max_bytes,
            backup_count=backup_count,
            filename=filename,
        )
    )
    logger = logging.getLogger(logger_name)
    for message in take_deferred_warnings():
        logger.warning(message)
    return logger
