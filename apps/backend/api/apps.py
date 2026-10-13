import logging
from importlib import import_module

from django.apps import AppConfig
from django.db import DatabaseError

from librephotos.logging_bootstrap import (
    DEFAULT_LOG_BACKUP_COUNT,
    DEFAULT_LOG_MAX_BYTES,
    LoggingNotConfiguredError,
    require_file_handler,
    take_deferred,
)

logger = logging.getLogger(__name__)

# Every module that connects model signal receivers, which is every place
# that runs code when a row is saved or deleted. Each exposes register(),
# connecting its receivers with a "<module>.<name>" dispatch_uid; ready()
# calls them in this order, once all models are loaded.
# api/tests/infra/test_signal_receivers.py enforces the list.
SIGNAL_MODULES = (
    # Photo counts and covers of thing albums and tags.
    "api.models.album_thing",
    "api.models.tag",
    # File clean-up (face crops, thumbnails), deferred to on_commit.
    "api.photos.file_cleanup",
    # Delta-sync bookkeeping: last_modified bumps + tombstone writers
    # (mobile v2, doc 04).
    "api.sync_signals",
    # Before a user is deleted, however that happens: turn off their public
    # links and make room for their albums and tags in ``deleted``.
    "api.accounts.deletion",
)


def reconfigure_logging() -> None:
    """Apply the constance log rotation settings to the live file handler.

    Called once per process from ``ApiConfig.ready()``, which is as early as
    ``constance.config`` can be read. It is idempotent: applying the same values
    again is a no-op. Raises ``LoggingNotConfiguredError`` when the LOGGING
    configuration installed no file handler.

    When constance cannot be read - the first ``migrate`` runs before its table
    exists - whatever is already applied is left alone. Resetting to the
    defaults instead would silently undo an admin's setting on every management
    command that runs before the database is ready.
    """
    handler = require_file_handler()

    try:
        from constance import config as constance_config

        max_bytes = int(
            getattr(constance_config, "LOG_MAX_BYTES", DEFAULT_LOG_MAX_BYTES)
        )
        backup_count = int(
            getattr(constance_config, "LOG_BACKUP_COUNT", DEFAULT_LOG_BACKUP_COUNT)
        )
    except (DatabaseError, TypeError, ValueError):
        # Constance is not readable yet (or holds a value that is not a
        # number); keep what the handler already has.
        return

    # The handler is a ConcurrentRotatingFileHandler (concurrent_log_handler,
    # untyped), which keeps its rotation limits as plain attributes.
    setattr(handler, "maxBytes", max_bytes)
    setattr(handler, "backupCount", backup_count)


class ApiConfig(AppConfig):
    name = "api"
    verbose_name = "LibrePhotos"

    def ready(self) -> None:
        # This is the first point in the boot where logging is fully configured,
        # so anything the settings module noticed while building that
        # configuration gets reported here rather than lost.
        for level, message in take_deferred():
            logger.log(level, message)

        from django.core import checks

        from api.checks import (
            check_database_not_newer,
            check_default_db_password,
            check_squashed_migration_history,
        )

        checks.register(check_default_db_password, checks.Tags.security)
        checks.register(check_squashed_migration_history, checks.Tags.database)
        checks.register(check_database_not_newer, checks.Tags.database)

        for module in SIGNAL_MODULES:
            import_module(module).register()

        # Not a model signal, so not in SIGNAL_MODULES: a saved site setting
        # drops this process's cached copy of the feature switches.
        from api.runtime import features

        features.register()

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

        self._install_oidc_adapter()

    def _install_oidc_adapter(self) -> None:
        """Point allauth's OIDC provider at our callback-URL-aware adapter.

        ``oauth2_adapter_class`` is the attribute allauth expects a provider to
        set in order to supply its own adapter, but the generic OIDC provider is
        instantiated per ``SocialApp`` rather than subclassed, so there is no
        subclass of our own to declare it on — hence assigning it here.

        This has to happen at the provider level rather than in the view: the
        login redirect is built by ``OAuth2Provider.redirect()``, which
        constructs a *fresh* adapter from this attribute and ignores whatever
        instance a view was handed. Overriding only the view would leave the
        login redirect using allauth's callback URL and the token exchange using
        ours, and OIDC requires the two to be byte-identical.
        """
        from allauth.socialaccount.providers.openid_connect.provider import (
            OpenIDConnectProvider,
        )

        from api.views.sso import LibrePhotosOIDCAdapter

        OpenIDConnectProvider.oauth2_adapter_class = LibrePhotosOIDCAdapter
