"""Every SQLite deployment gets the same connection options.

``production_noproxy`` (the unified image and the Windows standalone build) and
``dev_windows`` used to write their SQLite ``DATABASES`` block out separately,
and the copies drifted: a 5 s lock timeout in one and 30 s in the other, and the
mmap and journal-size pragmas in only one. Both now come from
``librephotos/settings/_sqlite.py`` (#2337); this pins it.

Imported in a subprocess for the same reason as test_noproxy_settings_overlay:
both modules have import-time side effects (they create the database
directory) and only run once per interpreter.
"""

import json
import os
import subprocess
import sys
import tempfile

from django.conf import settings
from django.test import SimpleTestCase

BACKEND_ROOT = os.path.dirname(str(settings.BASE_DIR))

PROBE = """
import json

import librephotos.settings.dev_windows as dev_windows
import librephotos.settings.production_noproxy as noproxy

print(json.dumps({
    "noproxy": noproxy.DATABASES["default"],
    "dev_windows": dev_windows.DATABASES["default"],
}))
"""


class SqliteSettingsParityTest(SimpleTestCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        with tempfile.TemporaryDirectory() as tmp:
            environ = {
                k: v
                for k, v in os.environ.items()
                if k not in ("DB_BACKEND", "DJANGO_SETTINGS_MODULE")
            }
            environ.update(
                {
                    "BASE_DATA": tmp,
                    "BASE_LOGS": os.path.join(tmp, "logs"),
                    "SECRET_KEY": "test-secret-key",
                    "PYTHONPATH": BACKEND_ROOT,
                }
            )
            os.makedirs(environ["BASE_LOGS"], exist_ok=True)
            result = subprocess.run(
                [sys.executable, "-c", PROBE],
                capture_output=True,
                text=True,
                check=True,
                cwd=BACKEND_ROOT,
                env=environ,
                timeout=120,
            )
        # The settings modules print which secret key and database they use.
        cls.databases = json.loads(result.stdout.strip().splitlines()[-1])

    def test_same_options_apart_from_the_file_name(self):
        noproxy = self.databases["noproxy"]
        dev_windows = self.databases["dev_windows"]
        self.assertEqual(noproxy["ENGINE"], dev_windows["ENGINE"])
        self.assertEqual(noproxy["OPTIONS"], dev_windows["OPTIONS"])
        self.assertNotEqual(noproxy["NAME"], dev_windows["NAME"])

    def test_options(self):
        options = self.databases["noproxy"]["OPTIONS"]
        self.assertEqual(
            "django.db.backends.sqlite3", self.databases["noproxy"]["ENGINE"]
        )
        self.assertEqual(30, options["timeout"])
        self.assertEqual("IMMEDIATE", options["transaction_mode"])
        for pragma in (
            "journal_mode=WAL",
            "synchronous=NORMAL",
            "mmap_size=134217728",
            "journal_size_limit=27103364",
            "cache_size=2000",
        ):
            self.assertIn(f"PRAGMA {pragma};", options["init_command"])

    def test_file_names(self):
        self.assertTrue(
            self.databases["noproxy"]["NAME"].endswith(
                os.path.join("db", "librephotos.sqlite3")
            )
        )
        self.assertTrue(
            self.databases["dev_windows"]["NAME"].endswith("librephotos-dev.sqlite3")
        )
