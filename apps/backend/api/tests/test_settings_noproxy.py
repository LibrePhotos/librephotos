"""The unified image's settings must stay a thin overlay on production.

deploy/docker/unified/ used to carry a second, hand-maintained copy of
production.py that the entrypoint pasted over the real one at boot. The copy
fell behind - constance keys added to production (MAP_TILE_PROVIDER, later
OCR_MODEL) never reached it, and SiteSettingsView reads them unconditionally, so
every unified install answered `GET /api/sitesettings` with a 500. These tests
pin the overlay so a copy cannot creep back in.

The settings module is imported in a subprocess: importing it in-process would
not re-run production.py (the test settings already imported it), and its
DB_BACKEND branch has import-time side effects that want a throwaway BASE_DATA.
"""

import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

from django.conf import settings
from django.test import SimpleTestCase

BACKEND_ROOT = Path(settings.BASE_DIR).parent
REPO_ROOT = BACKEND_ROOT.parent.parent
UNIFIED_DIR = REPO_ROOT / "deploy" / "docker" / "unified"

PROBE = """
import json

import librephotos.settings.production as prod
import librephotos.settings.production_noproxy as noproxy

print(json.dumps({
    "prod_constance": sorted(prod.CONSTANCE_CONFIG),
    "noproxy_constance": sorted(noproxy.CONSTANCE_CONFIG),
    "prod_fields": sorted(prod.CONSTANCE_ADDITIONAL_FIELDS),
    "noproxy_fields": sorted(noproxy.CONSTANCE_ADDITIONAL_FIELDS),
    "prod_rest_framework": repr(prod.REST_FRAMEWORK),
    "noproxy_rest_framework": repr(noproxy.REST_FRAMEWORK),
    "prod_databases": repr(prod.DATABASES),
    "noproxy_databases": repr(noproxy.DATABASES),
    "serve_frontend": noproxy.SERVE_FRONTEND,
    "middleware": list(noproxy.MIDDLEWARE),
    "installed_apps": list(noproxy.INSTALLED_APPS),
    "engine": noproxy.DATABASES["default"]["ENGINE"],
    "email_backend": noproxy.EMAIL_BACKEND,
    "allowed_hosts": list(noproxy.ALLOWED_HOSTS),
}))
"""


def load_noproxy_settings(**env):
    """Import the no-proxy settings in a clean interpreter and report on them."""
    with tempfile.TemporaryDirectory() as tmp:
        environ = dict(os.environ)
        environ.pop("DB_BACKEND", None)
        environ.update(
            {
                "BASE_DATA": tmp,
                "BASE_LOGS": os.path.join(tmp, "logs"),
                "SECRET_KEY": "test-secret-key",
                "PYTHONPATH": str(BACKEND_ROOT),
            }
        )
        environ.update(env)
        os.makedirs(environ["BASE_LOGS"], exist_ok=True)
        result = subprocess.run(
            [sys.executable, "-c", PROBE],
            capture_output=True,
            text=True,
            check=True,
            cwd=str(BACKEND_ROOT),
            env=environ,
        )
    # The settings module prints which database backend it picked.
    return json.loads(result.stdout.strip().splitlines()[-1])


class NoProxySettingsTest(SimpleTestCase):
    def test_constance_surface_matches_production(self):
        """The 500 that started this: a key production has and the overlay lacks."""
        loaded = load_noproxy_settings()
        self.assertEqual(loaded["noproxy_constance"], loaded["prod_constance"])
        self.assertEqual(loaded["noproxy_fields"], loaded["prod_fields"])
        self.assertIn("MAP_TILE_PROVIDER", loaded["noproxy_constance"])

    def test_inherits_production_settings_it_has_no_reason_to_change(self):
        loaded = load_noproxy_settings()
        self.assertEqual(
            loaded["noproxy_rest_framework"], loaded["prod_rest_framework"]
        )
        self.assertEqual(loaded["email_backend"], "api.mail.DynamicEmailBackend")

    def test_serves_the_frontend(self):
        loaded = load_noproxy_settings()
        self.assertTrue(loaded["serve_frontend"])
        self.assertEqual(loaded["allowed_hosts"], ["*"])

    def test_whitenoise_follows_the_security_middleware(self):
        middleware = load_noproxy_settings()["middleware"]
        security = middleware.index("django.middleware.security.SecurityMiddleware")
        self.assertEqual(
            middleware[security + 1], "whitenoise.middleware.WhiteNoiseMiddleware"
        )

    def test_sqlite_is_the_default_and_drops_the_postgres_app(self):
        loaded = load_noproxy_settings()
        self.assertEqual(loaded["engine"], "django.db.backends.sqlite3")
        self.assertNotIn("django.contrib.postgres", loaded["installed_apps"])

    def test_postgresql_keeps_productions_database_configuration(self):
        loaded = load_noproxy_settings(DB_BACKEND="postgresql")
        self.assertEqual(loaded["noproxy_databases"], loaded["prod_databases"])
        self.assertIn("django.contrib.postgres", loaded["installed_apps"])

    def test_an_unknown_backend_is_refused(self):
        with self.assertRaises(subprocess.CalledProcessError) as caught:
            load_noproxy_settings(DB_BACKEND="mysql")
        self.assertIn("Unsupported DB_BACKEND", caught.exception.stderr)


@unittest.skipUnless(
    UNIFIED_DIR.is_dir(), "deploy/ is not present outside a source checkout"
)
class NoProxyDeploymentTest(SimpleTestCase):
    def test_the_image_ships_no_second_copy_of_the_settings(self):
        self.assertFalse((UNIFIED_DIR / "production_noproxy.py").exists())

    def test_the_entrypoint_selects_the_module_instead_of_overwriting_production(self):
        entrypoint = (UNIFIED_DIR / "entrypoint.sh").read_text()
        self.assertIn("librephotos.settings.production_noproxy", entrypoint)
        overwrites_settings = [
            line
            for line in entrypoint.splitlines()
            if line.strip().startswith("cp ") and "librephotos/settings/" in line
        ]
        self.assertEqual(overwrites_settings, [])
