import logging

from django.apps import AppConfig

from librephotos.logging_bootstrap import take_deferred_warnings

logger = logging.getLogger(__name__)


class ApiConfig(AppConfig):
    name = "api"
    verbose_name = "LibrePhotos"

    def ready(self):
        # This is the first point in the boot where logging is fully configured,
        # so anything the settings module noticed while building that
        # configuration gets reported here rather than lost.
        for message in take_deferred_warnings():
            logger.warning(message)

        from api.util import LoggingNotConfiguredError, reconfigure_logging

        # Delta-sync bookkeeping: last_modified bumps + tombstone writers
        # (mobile v2, doc 04). Registered here so all models are loaded first.
        from api import sync_signals

        sync_signals.register()

        try:
            reconfigure_logging()
        except LoggingNotConfiguredError:
            # A log configuration without a file handler must not stop the
            # process from booting; say so and carry on with whatever handlers
            # are there. reconfigure_logging() itself tolerates constance being
            # unreadable (the first migrate runs before its table exists) and
            # leaves the current rotation settings alone in that case.
            logger.exception("Could not apply the log rotation settings")
        except Exception:
            # Nothing else is expected to escape reconfigure_logging(), but
            # ready() runs in every worker and management command: failing to
            # adjust a rotation setting is never worth refusing to start over.
            logger.exception("Unexpected error while configuring logging")
