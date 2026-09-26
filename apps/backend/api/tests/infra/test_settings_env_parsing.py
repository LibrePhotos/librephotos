"""Environment parsing in ``librephotos/settings/production.py``.

Several settings parsed the environment by hand, each in its own way:

* ``DEMO_SITE`` was on for any value other than the exact string ``False``, so
  ``DEMO_SITE=false``, ``0`` or an empty value all switched demo mode *on* -
  and demo mode silently drops every password change (serializers/user.py).
* ``ALLOW_UPLOAD`` had a third private list of "off" spellings.
* ``DEFAULT_FAVORITE_MIN_RATING`` was an ``int`` by default but a ``str``
  whenever it came from the environment.
* ``CSRF_TRUSTED_ORIGINS`` appended the raw value, so a comma-separated list
  became one bogus origin.
* ``DB_PASS`` fell back to a hardcoded password without saying so.
"""

import importlib
import os
from unittest.mock import patch

from django.core.exceptions import ImproperlyConfigured
from django.test import SimpleTestCase, override_settings

from api.checks import check_default_db_password
from librephotos.settings import production

_TOUCHED = (
    "DEMO_SITE",
    "ALLOW_UPLOAD",
    "DEFAULT_FAVORITE_MIN_RATING",
    "CSRF_TRUSTED_ORIGINS",
    "DB_PASS",
)


class _ReloadMixin:
    def setUp(self):
        super().setUp()
        # Every case reloads the settings module under a doctored environment;
        # put the module back the way the rest of the suite expects it.
        self.addCleanup(importlib.reload, production)

    def _reload(self, **values):
        environment = {k: v for k, v in os.environ.items() if k not in _TOUCHED}
        environment.update(values)
        with patch.dict(os.environ, environment, clear=True):
            importlib.reload(production)
        return production


class DemoSiteParsingTest(_ReloadMixin, SimpleTestCase):
    def test_unset_is_off(self):
        self.assertFalse(self._reload().DEMO_SITE)

    def test_empty_is_off(self):
        self.assertFalse(self._reload(DEMO_SITE="").DEMO_SITE)

    def test_lowercase_false_is_off(self):
        self.assertFalse(self._reload(DEMO_SITE="false").DEMO_SITE)

    def test_zero_is_off(self):
        self.assertFalse(self._reload(DEMO_SITE="0").DEMO_SITE)

    def test_capitalised_false_is_off(self):
        self.assertFalse(self._reload(DEMO_SITE="False").DEMO_SITE)

    def test_true_is_on(self):
        self.assertTrue(self._reload(DEMO_SITE="True").DEMO_SITE)
        self.assertTrue(self._reload(DEMO_SITE="1").DEMO_SITE)


class AllowUploadParsingTest(_ReloadMixin, SimpleTestCase):
    def _allow_upload(self, **values):
        return self._reload(**values).CONSTANCE_CONFIG["ALLOW_UPLOAD"][0]

    def test_unset_defaults_to_on(self):
        self.assertTrue(self._allow_upload())

    def test_empty_keeps_uploads_on_as_before(self):
        self.assertTrue(self._allow_upload(ALLOW_UPLOAD=""))

    def test_off_spellings(self):
        for value in ("false", "False", "FALSE", "0", "no", "off"):
            with self.subTest(value=value):
                self.assertFalse(self._allow_upload(ALLOW_UPLOAD=value))

    def test_on_spellings(self):
        for value in ("true", "True", "1", "yes", "on"):
            with self.subTest(value=value):
                self.assertTrue(self._allow_upload(ALLOW_UPLOAD=value))


class FavoriteMinRatingParsingTest(_ReloadMixin, SimpleTestCase):
    def test_default_is_int(self):
        self.assertEqual(4, self._reload().DEFAULT_FAVORITE_MIN_RATING)

    def test_env_value_is_int(self):
        value = self._reload(
            DEFAULT_FAVORITE_MIN_RATING="3"
        ).DEFAULT_FAVORITE_MIN_RATING
        self.assertEqual(3, value)
        self.assertIsInstance(value, int)

    def test_garbage_names_the_variable(self):
        with self.assertRaisesMessage(
            ImproperlyConfigured, "DEFAULT_FAVORITE_MIN_RATING"
        ):
            self._reload(DEFAULT_FAVORITE_MIN_RATING="three")


class CsrfTrustedOriginsParsingTest(_ReloadMixin, SimpleTestCase):
    def test_unset_keeps_only_the_dev_origin(self):
        self.assertEqual(["http://localhost:3000"], self._reload().CSRF_TRUSTED_ORIGINS)

    def test_single_origin(self):
        origins = self._reload(
            CSRF_TRUSTED_ORIGINS="https://photos.example.com"
        ).CSRF_TRUSTED_ORIGINS
        self.assertEqual(
            ["http://localhost:3000", "https://photos.example.com"], origins
        )

    def test_comma_separated_list(self):
        origins = self._reload(
            CSRF_TRUSTED_ORIGINS=" https://a.example.com, https://b.example.com ,"
        ).CSRF_TRUSTED_ORIGINS
        self.assertEqual(
            [
                "http://localhost:3000",
                "https://a.example.com",
                "https://b.example.com",
            ],
            origins,
        )


class DbPassDefaultTest(_ReloadMixin, SimpleTestCase):
    def test_env_value_is_used(self):
        settings_module = self._reload(DB_PASS="s3cret")
        self.assertEqual("s3cret", settings_module.DATABASES["default"]["PASSWORD"])
        self.assertTrue(settings_module.DB_PASS_FROM_ENV)

    def test_unset_keeps_the_legacy_fallback_but_records_it(self):
        """Existing installs whose compose file never passed DB_PASS keep working."""
        settings_module = self._reload()
        self.assertEqual(
            settings_module.INSECURE_DEFAULT_DB_PASSWORD,
            settings_module.DATABASES["default"]["PASSWORD"],
        )
        self.assertFalse(settings_module.DB_PASS_FROM_ENV)


_POSTGRES = {
    "default": {
        "ENGINE": "django.db.backends.postgresql",
        "PASSWORD": production.INSECURE_DEFAULT_DB_PASSWORD,
    }
}
_SQLITE = {"default": {"ENGINE": "django.db.backends.sqlite3", "NAME": ":memory:"}}


class DefaultDbPasswordCheckTest(SimpleTestCase):
    @override_settings(DATABASES=_POSTGRES, DB_PASS_FROM_ENV=False)
    def test_warns_when_postgres_runs_on_the_fallback_password(self):
        warnings = check_default_db_password(None)
        self.assertEqual(["librephotos.W001"], [w.id for w in warnings])
        self.assertIn("DB_PASS", warnings[0].msg)

    @override_settings(DATABASES=_POSTGRES, DB_PASS_FROM_ENV=True)
    def test_quiet_when_db_pass_was_set_explicitly(self):
        self.assertEqual([], check_default_db_password(None))

    @override_settings(DATABASES=_SQLITE, DB_PASS_FROM_ENV=False)
    def test_quiet_on_sqlite(self):
        self.assertEqual([], check_default_db_password(None))


class EnvHelpersTest(SimpleTestCase):
    def test_env_flag_blank_is_off_unless_told_otherwise(self):
        """FEATURE_X= switches a feature off (see test_feature_flag_gating)."""
        with patch.dict(os.environ, {"X_FLAG": "  "}):
            self.assertFalse(production._env_flag("X_FLAG", default=True))
            self.assertTrue(production._env_flag("X_FLAG", default=True, empty=True))

    def test_env_int_blank_is_default(self):
        with patch.dict(os.environ, {"X_INT": ""}):
            self.assertEqual(7, production._env_int("X_INT", 7))

    def test_env_list_unset_is_default(self):
        with patch.dict(os.environ, {}, clear=True):
            self.assertEqual([], production._env_list("X_LIST"))
            self.assertEqual(["a"], production._env_list("X_LIST", ["a"]))
