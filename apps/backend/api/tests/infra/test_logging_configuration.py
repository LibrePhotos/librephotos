import logging
import logging.config
import os
import shutil
import tempfile
from contextlib import contextmanager
from unittest.mock import patch

from concurrent_log_handler import ConcurrentRotatingFileHandler
from django.conf import settings
from django.test import SimpleTestCase

from api import util
from api.util import (
    DEFAULT_LOG_BACKUP_COUNT,
    DEFAULT_LOG_MAX_BYTES,
    FILE_HANDLER,
    reconfigure_logging,
)
from librephotos.logging_bootstrap import (
    DEFAULT_LOGS_ROOT,
    LOG_FILE_HANDLER_NAME,
    LOG_FILENAME,
    build_logging_config,
    ensure_logs_root,
    resolve_level,
    take_deferred_warnings,
)


@contextmanager
def temporary_logging(**kwargs):
    """Apply a logging configuration for the duration of the block.

    Yields the path of the log file it writes to. ``dictConfig`` replaces the
    handler objects wholesale rather than mutating them, so the configuration
    from settings has to be re-applied and ``api.util.FILE_HANDLER`` re-resolved
    afterwards - otherwise every later test in the run would be holding a closed
    handler pointing into a deleted directory.
    """
    logs_root = tempfile.mkdtemp(prefix="librephotos-logtest-")
    kwargs.setdefault("to_console", False)
    try:
        logging.config.dictConfig(build_logging_config(logs_root=logs_root, **kwargs))
        yield os.path.join(logs_root, LOG_FILENAME)
    finally:
        logging.config.dictConfig(settings.LOGGING)
        util.FILE_HANDLER = util.get_file_handler()
        shutil.rmtree(logs_root, ignore_errors=True)


def flush_root_handlers():
    for handler in logging.getLogger().handlers:
        handler.flush()


def reachable_handler_names(logger_name):
    """Names of the handlers a record logged to ``logger_name`` would reach.

    Mirrors what ``logging.Logger.callHandlers`` does: walk up the hierarchy
    collecting handlers until a logger that does not propagate stops the ascent.
    """
    names = []
    current = logging.getLogger(logger_name)
    while current:
        names.extend(getattr(handler, "name", None) for handler in current.handlers)
        if not current.propagate:
            break
        current = current.parent
    return names


class LogRotationDefaultsTest(SimpleTestCase):
    """Verify that the default log rotation values are sensible."""

    def test_default_max_bytes_is_200mb(self):
        self.assertEqual(DEFAULT_LOG_MAX_BYTES, 200 * 1024 * 1024)

    def test_default_backup_count(self):
        self.assertEqual(DEFAULT_LOG_BACKUP_COUNT, 10)

    def test_handler_uses_defaults(self):
        # The module-level handler should start with the defaults
        self.assertEqual(FILE_HANDLER.maxBytes, DEFAULT_LOG_MAX_BYTES)
        self.assertEqual(FILE_HANDLER.backupCount, DEFAULT_LOG_BACKUP_COUNT)

    def test_handler_is_concurrent(self):
        self.assertIsInstance(FILE_HANDLER, ConcurrentRotatingFileHandler)


class LogFileLocationTest(SimpleTestCase):
    """Pin down *which file* the logger writes to.

    Nothing used to assert this, so api/util.py could have pointed the handler
    anywhere and the whole suite would still have passed - including at the
    directory ServerLogsView does not serve from.
    """

    def setUp(self):
        self.handler = util.get_file_handler()
        self.assertIsNotNone(
            self.handler, f"no {LOG_FILE_HANDLER_NAME!r} handler on the root logger"
        )

    def test_handler_writes_under_logs_root(self):
        expected = os.path.abspath(os.path.join(settings.LOGS_ROOT, LOG_FILENAME))
        self.assertEqual(self.handler.baseFilename, expected)

    def test_handler_does_not_fall_back_to_the_default_logs_root(self):
        # Guard that the assertion below is actually testing something.
        self.assertNotEqual(settings.LOGS_ROOT, DEFAULT_LOGS_ROOT)
        self.assertFalse(self.handler.baseFilename.startswith(DEFAULT_LOGS_ROOT))

    def test_settings_logging_owns_the_handler_name(self):
        handler_config = settings.LOGGING["handlers"][LOG_FILE_HANDLER_NAME]
        self.assertEqual(handler_config["filename"], self.handler.baseFilename)

    def test_exactly_one_file_handler_on_the_root_logger(self):
        # A second file handler would duplicate every line of the file an admin
        # downloads from the Server Logs card.
        file_handlers = [
            handler
            for handler in logging.getLogger().handlers
            if isinstance(handler, logging.FileHandler)
        ]
        self.assertEqual(len(file_handlers), 1, file_handlers)


class LogLevelTest(SimpleTestCase):
    """LOG_LEVEL has to reach the project loggers, and must never crash the boot."""

    def setUp(self):
        # resolve_level parks its complaints in a module-level list; start from a
        # known state so the assertions below cannot pick up someone else's.
        take_deferred_warnings()

    def tearDown(self):
        take_deferred_warnings()

    def test_debug_level_reaches_the_project_logger(self):
        # The acceptance criterion is the logger.debug() calls in
        # api/face_extractor.py, api/models/photo_search.py, api/geocode/geocode.py,
        # api/stacks/live_photo.py and api/stack_detection.py - all of them go
        # through the "ownphotos" logger and were unreachable before.
        with temporary_logging(level="DEBUG") as log_file:
            self.assertEqual(util.logger.getEffectiveLevel(), logging.DEBUG)
            util.logger.debug("region_info debug line")
            flush_root_handlers()
            with open(log_file, encoding="utf-8") as f:
                self.assertIn("region_info debug line", f.read())

    def test_third_party_floor_survives_debug(self):
        # LOG_LEVEL=DEBUG must not turn django-q2's per-task chatter back on.
        with temporary_logging(level="DEBUG"):
            self.assertEqual(
                logging.getLogger("django_q").getEffectiveLevel(), logging.INFO
            )
            self.assertEqual(
                logging.getLogger("django.db.backends").getEffectiveLevel(),
                logging.WARNING,
            )

    def test_floors_tighten_with_the_requested_level(self):
        # A floor should never make a logger more verbose than the admin asked
        # for, so ERROR pushes the INFO floors down with everything else.
        config = build_logging_config(level="ERROR")
        self.assertEqual(config["loggers"]["django_q"]["level"], "ERROR")
        self.assertEqual(config["loggers"]["urllib3"]["level"], "ERROR")

    def test_unknown_level_falls_back_to_info_instead_of_raising(self):
        # dictConfig raises ValueError on an unknown level, and it does so while
        # the settings module is importing, before any handler exists - a typo in
        # LOG_LEVEL would be an unexplained crash loop.
        self.assertEqual(resolve_level("LOUD"), "INFO")
        warnings = take_deferred_warnings()
        self.assertEqual(len(warnings), 1)
        self.assertIn("LOG_LEVEL", warnings[0])
        self.assertIn("LOUD", warnings[0])

        with temporary_logging(level="LOUD") as log_file:
            self.assertEqual(logging.getLogger().level, logging.INFO)
            util.logger.info("still logging after a bad LOG_LEVEL")
            flush_root_handlers()
            with open(log_file, encoding="utf-8") as f:
                self.assertIn("still logging after a bad LOG_LEVEL", f.read())

    def test_empty_level_is_info(self):
        self.assertEqual(resolve_level(""), "INFO")
        self.assertEqual(take_deferred_warnings(), [])


class ModuleLoggerReachabilityTest(SimpleTestCase):
    """The getLogger(__name__) modules have to reach the file handler.

    api.mail, api.apps, api.views.email_config and api.views.password_reset all
    used to fall through to logging.lastResort on stderr, so SMTP and
    password-reset failures never appeared in the file users are asked to attach
    to a bug report.
    """

    MODULE_LOGGERS = (
        "api.mail",
        "api.apps",
        "api.views.email_config",
        "api.views.password_reset",
    )

    def test_module_loggers_reach_the_file_handler(self):
        for name in self.MODULE_LOGGERS:
            with self.subTest(logger=name):
                self.assertIn(LOG_FILE_HANDLER_NAME, reachable_handler_names(name))

    def test_module_logger_records_land_in_the_log_file(self):
        with temporary_logging(level="INFO") as log_file:
            for name in self.MODULE_LOGGERS:
                logging.getLogger(name).error("failure reported by %s", name)
            flush_root_handlers()
            with open(log_file, encoding="utf-8") as f:
                contents = f.read()
        for name in self.MODULE_LOGGERS:
            with self.subTest(logger=name):
                self.assertIn(f"failure reported by {name}", contents)

    def test_the_modules_really_use_those_logger_names(self):
        # The assertions above are only worth anything if these are the loggers
        # the modules actually log through.
        from api import apps, mail
        from api.views import email_config, password_reset

        self.assertEqual(mail.logger.name, "api.mail")
        self.assertEqual(apps.logger.name, "api.apps")
        self.assertEqual(email_config.logger.name, "api.views.email_config")
        self.assertEqual(password_reset.logger.name, "api.views.password_reset")


class EnsureLogsRootTest(SimpleTestCase):
    def test_creates_a_missing_directory(self):
        parent = tempfile.mkdtemp(prefix="librephotos-logtest-")
        self.addCleanup(shutil.rmtree, parent, True)
        logs_root = os.path.join(parent, "nested", "logs")

        self.assertEqual(ensure_logs_root(logs_root), logs_root)
        self.assertTrue(os.path.isdir(logs_root))

    def test_existing_directory_is_accepted(self):
        logs_root = tempfile.mkdtemp(prefix="librephotos-logtest-")
        self.addCleanup(shutil.rmtree, logs_root, True)

        self.assertEqual(ensure_logs_root(logs_root), logs_root)

    def test_uncreatable_directory_names_the_path_and_base_logs(self):
        parent = tempfile.mkdtemp(prefix="librephotos-logtest-")
        self.addCleanup(shutil.rmtree, parent, True)
        # A file where a directory is expected: makedirs cannot descend into it.
        blocker = os.path.join(parent, "not-a-directory")
        with open(blocker, "w") as f:
            f.write("")
        logs_root = os.path.join(blocker, "logs")

        with self.assertRaises(RuntimeError) as caught:
            ensure_logs_root(logs_root)
        message = str(caught.exception)
        self.assertIn(logs_root, message)
        self.assertIn("BASE_LOGS", message)

    def test_unwritable_directory_names_the_path_and_base_logs(self):
        logs_root = tempfile.mkdtemp(prefix="librephotos-logtest-")
        self.addCleanup(shutil.rmtree, logs_root, True)

        # chmod is unreliable on Windows and a no-op for root on Linux, so the
        # read-only mount is simulated at the access check itself.
        with patch("librephotos.logging_bootstrap.os.access", return_value=False):
            with self.assertRaises(RuntimeError) as caught:
                ensure_logs_root(logs_root)
        message = str(caught.exception)
        self.assertIn(logs_root, message)
        self.assertIn("BASE_LOGS", message)


class ReconfigureLoggingTest(SimpleTestCase):
    """Test that reconfigure_logging reads from CONSTANCE and updates the handler."""

    def setUp(self):
        # Resolved live rather than taken from the import above: dictConfig hands
        # out a new handler object every time it runs, so a name bound at import
        # time can go stale during a full test run.
        self.handler = util.get_file_handler()
        self.assertIsNotNone(self.handler)

    def tearDown(self):
        # Restore defaults after each test to avoid leaking state
        self.handler.maxBytes = DEFAULT_LOG_MAX_BYTES
        self.handler.backupCount = DEFAULT_LOG_BACKUP_COUNT

    def test_reconfigure_applies_constance_values(self):
        custom_max = 500 * 1024 * 1024  # 500 MB
        custom_count = 5

        mock_config = type(
            "Config",
            (),
            {"LOG_MAX_BYTES": custom_max, "LOG_BACKUP_COUNT": custom_count},
        )()

        mock_constance = type("m", (), {"config": mock_config})()

        with patch.dict(
            "sys.modules",
            {"constance": mock_constance},
        ):
            reconfigure_logging()

        self.assertEqual(self.handler.maxBytes, custom_max)
        self.assertEqual(self.handler.backupCount, custom_count)

    def test_reconfigure_falls_back_on_error(self):
        """When constance raises (e.g. DB unavailable), defaults are preserved."""

        class _BrokenConfig:
            """Simulates constance when the database is not reachable."""

            @property
            def LOG_MAX_BYTES(self):
                raise Exception("DB unavailable")

        mock_constance = type("m", (), {"config": _BrokenConfig()})()

        with patch.dict("sys.modules", {"constance": mock_constance}):
            reconfigure_logging()

        self.assertEqual(self.handler.maxBytes, DEFAULT_LOG_MAX_BYTES)
        self.assertEqual(self.handler.backupCount, DEFAULT_LOG_BACKUP_COUNT)


class ConstanceConfigTest(SimpleTestCase):
    """Verify that CONSTANCE_CONFIG includes the log rotation entries."""

    def test_log_max_bytes_in_constance(self):
        from django.conf import settings

        self.assertIn("LOG_MAX_BYTES", settings.CONSTANCE_CONFIG)
        default, _help, typ = settings.CONSTANCE_CONFIG["LOG_MAX_BYTES"]
        self.assertEqual(default, 200 * 1024 * 1024)
        self.assertIs(typ, int)

    def test_log_backup_count_in_constance(self):
        from django.conf import settings

        self.assertIn("LOG_BACKUP_COUNT", settings.CONSTANCE_CONFIG)
        default, _help, typ = settings.CONSTANCE_CONFIG["LOG_BACKUP_COUNT"]
        self.assertEqual(default, 10)
        self.assertIs(typ, int)
