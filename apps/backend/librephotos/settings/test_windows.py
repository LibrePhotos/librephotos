"""Test settings for running the backend suite on a Windows dev box.

Installs import stubs for native / heavy-ML dependencies that can't be built on
Windows, then reuses the in-memory SQLite test settings. Run with the helper
script ``scripts/run_tests_windows.ps1`` or directly:

    DJANGO_SETTINGS_MODULE=librephotos.settings.test_windows \
    SECRET_KEY=test-secret-key BASE_LOGS=... BASE_DATA=... \
    python manage.py test api.tests
"""

from ._win_stubs import install as _install_stubs

_install_stubs()

from .test_sqlite import *  # noqa: E402,F401,F403
