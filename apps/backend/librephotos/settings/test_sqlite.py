"""
Test settings that use SQLite instead of PostgreSQL.

Usage:
    DJANGO_SETTINGS_MODULE=librephotos.settings.test_sqlite python manage.py test api.tests.migrations
"""

from ._sqlite import SQLITE_SILENCED_CHECKS
from .test import *  # noqa

DATABASES = {
    "default": {
        "ENGINE": "django.db.backends.sqlite3",
        "NAME": ":memory:",
    },
}
SILENCED_SYSTEM_CHECKS = SQLITE_SILENCED_CHECKS
