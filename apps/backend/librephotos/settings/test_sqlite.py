"""
Test settings that use SQLite instead of PostgreSQL.

Usage:
    DJANGO_SETTINGS_MODULE=librephotos.settings.test_sqlite python manage.py test api.tests.test_migration_0099
"""

from .test import *  # noqa

DATABASES = {
    "default": {
        "ENGINE": "django.db.backends.sqlite3",
        "NAME": ":memory:",
    },
}
