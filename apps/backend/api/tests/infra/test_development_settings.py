"""django-silk and django-extensions are development tools, not production apps.

They live in requirements.dev.txt, which only the DEBUG=1 image build installs.
Production settings name neither. ``librephotos.settings.development`` adds each
one when it is installed, so a production image started with ``DEBUG=1`` (which
picks the development settings) still boots without them.

The settings are imported in a subprocess: importing them in-process would not
re-run production.py, and development.py extends the lists production.py made.
"""

import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

from django.conf import settings
from django.test import SimpleTestCase

BACKEND_ROOT = Path(settings.BASE_DIR).parent

PROBE = """
import json
import sys

if sys.argv[1] == "without-dev-tools":
    # As if requirements.dev.txt were not installed: find_spec answers None and
    # an import fails.
    sys.modules["silk"] = None
    sys.modules["django_extensions"] = None

import librephotos.settings.production as production

# development.py extends production's lists in place: copy them first.
production_apps = list(production.INSTALLED_APPS)
production_middleware = list(production.MIDDLEWARE)

import librephotos.settings.development as development

print(json.dumps({
    "production_apps": production_apps,
    "production_middleware": production_middleware,
    "development_apps": list(development.INSTALLED_APPS),
    "development_middleware": list(development.MIDDLEWARE),
}))
"""


def load_settings(mode: str) -> dict[str, list[str]]:
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
        os.makedirs(environ["BASE_LOGS"], exist_ok=True)
        result = subprocess.run(
            [sys.executable, "-c", PROBE, mode],
            capture_output=True,
            text=True,
            check=True,
            cwd=str(BACKEND_ROOT),
            env=environ,
        )
    return json.loads(result.stdout.strip().splitlines()[-1])


class DevelopmentSettingsTest(SimpleTestCase):
    def test_production_names_no_development_tool(self):
        loaded = load_settings("without-dev-tools")

        self.assertNotIn("silk", loaded["production_apps"])
        self.assertNotIn("django_extensions", loaded["production_apps"])
        self.assertNotIn(
            "silk.middleware.SilkyMiddleware", loaded["production_middleware"]
        )

    def test_development_settings_load_without_the_tools(self):
        loaded = load_settings("without-dev-tools")

        self.assertNotIn("silk", loaded["development_apps"])
        self.assertNotIn("django_extensions", loaded["development_apps"])
        self.assertNotIn(
            "silk.middleware.SilkyMiddleware", loaded["development_middleware"]
        )

    def test_development_settings_add_the_installed_tools(self):
        try:
            import django_extensions  # noqa: F401
            import silk  # noqa: F401
        except ImportError:
            self.skipTest("requirements.dev.txt is not installed")

        loaded = load_settings("with-dev-tools")

        self.assertIn("silk", loaded["development_apps"])
        self.assertIn("django_extensions", loaded["development_apps"])
        self.assertIn(
            "silk.middleware.SilkyMiddleware", loaded["development_middleware"]
        )
