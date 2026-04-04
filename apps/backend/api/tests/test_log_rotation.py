import unittest
from unittest.mock import patch

from api.util import (
    DEFAULT_LOG_BACKUP_COUNT,
    DEFAULT_LOG_MAX_BYTES,
    FILE_HANDLER,
    reconfigure_logging,
)


class LogRotationDefaultsTest(unittest.TestCase):
    """Verify that the default log rotation values are sensible."""

    def test_default_max_bytes_is_200mb(self):
        self.assertEqual(DEFAULT_LOG_MAX_BYTES, 200 * 1024 * 1024)

    def test_default_backup_count(self):
        self.assertEqual(DEFAULT_LOG_BACKUP_COUNT, 10)

    def test_handler_uses_defaults(self):
        # The module-level handler should start with the defaults
        self.assertEqual(FILE_HANDLER.maxBytes, DEFAULT_LOG_MAX_BYTES)
        self.assertEqual(FILE_HANDLER.backupCount, DEFAULT_LOG_BACKUP_COUNT)


class ReconfigureLoggingTest(unittest.TestCase):
    """Test that reconfigure_logging reads from CONSTANCE and updates the handler."""

    def tearDown(self):
        # Restore defaults after each test to avoid leaking state
        FILE_HANDLER.maxBytes = DEFAULT_LOG_MAX_BYTES
        FILE_HANDLER.backupCount = DEFAULT_LOG_BACKUP_COUNT

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

        self.assertEqual(FILE_HANDLER.maxBytes, custom_max)
        self.assertEqual(FILE_HANDLER.backupCount, custom_count)

    def test_reconfigure_falls_back_on_error(self):
        # If constance is unavailable, defaults should be preserved
        FILE_HANDLER.maxBytes = DEFAULT_LOG_MAX_BYTES
        FILE_HANDLER.backupCount = DEFAULT_LOG_BACKUP_COUNT

        with patch("builtins.__import__", side_effect=ImportError):
            reconfigure_logging()

        self.assertEqual(FILE_HANDLER.maxBytes, DEFAULT_LOG_MAX_BYTES)
        self.assertEqual(FILE_HANDLER.backupCount, DEFAULT_LOG_BACKUP_COUNT)


class ConstanceConfigTest(unittest.TestCase):
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
