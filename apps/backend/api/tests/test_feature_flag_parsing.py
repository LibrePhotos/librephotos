"""FEATURE_PROCESS_EMBEDDED_MEDIA must behave like the other feature switches.

The six switches in ``librephotos/settings/production.py`` are parsed with
``_env_flag``, which accepts ``true``/``1``/``yes``/``on`` in any casing.
``FEATURE_PROCESS_EMBEDDED_MEDIA`` used a strict ``os.getenv(...) == "True"``
comparison instead, so the lowercase ``true`` that works for every neighbouring
flag silently left it on. It was also missing from the bundled Compose stack, so
nobody running ``deploy/compose`` could set it at all.
"""

import importlib
import os
import unittest
from pathlib import Path
from unittest.mock import patch

from django.test import SimpleTestCase

from librephotos.settings import production

BACKEND_DIR = Path(__file__).resolve().parents[2]
REPO_ROOT = BACKEND_DIR.parents[1]
COMPOSE_DIR = REPO_ROOT / "deploy" / "compose"


class ProcessEmbeddedMediaFlagParsingTest(SimpleTestCase):
    def setUp(self):
        # Every case reloads the settings module under a doctored environment;
        # put the module back the way the rest of the suite expects it.
        self.addCleanup(importlib.reload, production)

    def _flag_for(self, value):
        environment = dict(os.environ)
        if value is None:
            environment.pop("FEATURE_PROCESS_EMBEDDED_MEDIA", None)
        else:
            environment["FEATURE_PROCESS_EMBEDDED_MEDIA"] = value
        with patch.dict(os.environ, environment, clear=True):
            importlib.reload(production)
        return production.FEATURE_PROCESS_EMBEDDED_MEDIA

    def test_unset_leaves_embedded_media_processing_on(self):
        self.assertTrue(self._flag_for(None))

    def test_capitalised_true_keeps_working(self):
        """The only value the old comparison accepted has to stay accepted."""
        self.assertTrue(self._flag_for("True"))

    def test_lowercase_true_turns_the_feature_on(self):
        self.assertTrue(self._flag_for("true"))

    def test_one_turns_the_feature_on(self):
        self.assertTrue(self._flag_for("1"))

    def test_false_turns_the_feature_off(self):
        self.assertFalse(self._flag_for("false"))


class ProcessEmbeddedMediaComposeWiringTest(SimpleTestCase):
    """The bundled Compose stack has to expose the switch like the other six."""

    def _read(self, name):
        path = COMPOSE_DIR / name
        if not path.is_file():
            raise unittest.SkipTest(f"{path} is not available in this checkout")
        return path.read_text(encoding="utf-8")

    def test_docker_compose_forwards_the_variable_to_the_backend(self):
        self.assertIn(
            "FEATURE_PROCESS_EMBEDDED_MEDIA=${featureProcessEmbeddedMedia:-true}",
            self._read("docker-compose.yml"),
        )

    def test_librephotos_env_offers_the_setting(self):
        self.assertIn("featureProcessEmbeddedMedia=true", self._read("librephotos.env"))
