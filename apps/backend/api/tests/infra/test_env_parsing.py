"""librephotos/env.py, the one parser every environment variable goes through.

Issue #2337 moved five on/off parsers, two number parsers and a handful of
hand-rolled list splits onto it. Moving a variable must not flip it on an
existing install, so besides the unit tests for each parser this module keeps a
copy of every old parser (as it was on dev at d55257cb0) and checks old and new
agree on the values people actually set. The two places where they disagree on
purpose are pinned as such:

* ``NEXTCLOUD_ENABLED=t`` was on and is now off, with a warning in the log
  (release-note item).
* ``DJANGO_DEBUG`` (the native Windows dev server only) was on for exactly
  ``1``; ``true``/``yes``/``on`` now switch it on too.

Numbers that used to crash with a bare ValueError when blank now fall back to
their default; a value that is not a number still stops the process, now with
the variable's name in the message.
"""

import importlib
import logging
import os
from unittest.mock import patch

from django.test import SimpleTestCase

from librephotos import env, logging_bootstrap
from librephotos.settings import production

# What people put in compose files and .env files, plus the odd ones: None is
# "unset", "t" was NEXTCLOUD_ENABLED's private alias.
FLAG_VALUES = (
    None,
    "",
    "  ",
    "1",
    "0",
    "true",
    "false",
    "True",
    "False",
    "TRUE",
    "FALSE",
    "yes",
    "no",
    "on",
    "off",
    " On ",
    "t",
    "nonsense",
)

NUMBER_VALUES = (None, "0", "1", "7", " 8 ", "-3", "101")


def _environ(name, value):
    environment = {k: v for k, v in os.environ.items() if k != name}
    if value is not None:
        environment[name] = value
    return patch.dict(os.environ, environment, clear=True)


# --- the old parsers, verbatim apart from taking the value as an argument ---


def legacy_env_flag(value, default=True, empty=False):
    """production._env_flag."""
    if value is None:
        return default
    value = value.strip()
    if not value:
        return empty
    return value.lower() in ("true", "1", "yes", "on")


def legacy_opt_in(value):
    """dev_windows._opt_in."""
    return (value or "").strip().lower() in ("true", "1", "yes", "on")


def legacy_nextcloud_enabled(value):
    """The inline NEXTCLOUD_ENABLED parse in production.CONSTANCE_CONFIG."""
    return (value or "").strip().lower() in ("true", "1", "t", "yes", "on")


def legacy_log_to_console(value):
    """logging_bootstrap.resolve_to_console reading the environment."""
    if value is None:
        return True
    return str(value).strip().lower() in ("true", "1", "yes", "on")


def legacy_django_debug(value):
    """dev_windows.DEBUG (and the DEBUG switch in manage.py / wsgi.py)."""
    return (value if value is not None else "0") == "1"


def legacy_onnx_cpu_arena(value, variable_shapes):
    """service.onnx_session.cpu_arena."""
    value = (value or "").strip().lower()
    if value in ("1", "true", "yes", "on"):
        return True
    if value in ("0", "false", "no", "off"):
        return False
    return not variable_shapes


def legacy_onnx_intra_op_threads(value):
    """service.onnx_session.intra_op_threads, before the > 0 check."""
    try:
        return int((value if value is not None else "") or 0)
    except ValueError:
        return None


def legacy_worker_concurrency(value):
    """production: Q_CLUSTER["workers"] only when WORKER_CONCURRENCY is truthy."""
    return int(value) if value else None


def legacy_csrf_noproxy(value):
    """production_noproxy.CSRF_TRUSTED_ORIGINS."""
    raw = value if value is not None else ""
    return [origin.strip() for origin in raw.split(",") if origin.strip()]


def legacy_csrf_standalone(value):
    """settings/standalone.CSRF_TRUSTED_ORIGINS."""
    raw = value if value is not None else "http://localhost:8000,http://127.0.0.1:8000"
    return [origin.strip() for origin in raw.split(",") if origin.strip()]


class EnvStrTest(SimpleTestCase):
    def test_unset_is_the_default(self):
        with _environ("X_STR", None):
            self.assertEqual("", env.env_str("X_STR"))
            self.assertEqual("fallback", env.env_str("X_STR", "fallback"))
            self.assertIsNone(env.env_str("X_STR", None))

    def test_blank_is_kept_as_it_is(self):
        """Callers that want blank to mean the default write ``or default``."""
        with _environ("X_STR", ""):
            self.assertEqual("", env.env_str("X_STR", "fallback"))
            self.assertEqual("", env.env_str("X_STR", None))

    def test_value_is_returned_unchanged(self):
        with _environ("X_STR", " a value "):
            self.assertEqual(" a value ", env.env_str("X_STR", "fallback"))


class EnvFlagTest(SimpleTestCase):
    def test_unset_is_the_default(self):
        with _environ("X_FLAG", None):
            self.assertTrue(env.env_flag("X_FLAG", default=True))
            self.assertFalse(env.env_flag("X_FLAG", default=False))

    def test_blank_is_empty(self):
        with _environ("X_FLAG", " "):
            self.assertFalse(env.env_flag("X_FLAG", default=True))
            self.assertTrue(env.env_flag("X_FLAG", default=False, empty=True))

    def test_on_and_off_spellings(self):
        for value in ("true", "TRUE", "1", "yes", "on", " On "):
            with self.subTest(value=value), _environ("X_FLAG", value):
                self.assertTrue(env.env_flag("X_FLAG", default=False))
        for value in ("false", "FALSE", "0", "no", "off", " Off "):
            with self.subTest(value=value), _environ("X_FLAG", value):
                self.assertFalse(env.env_flag("X_FLAG", default=True))

    def test_unrecognised_value_is_off_and_logged_with_the_name(self):
        with (
            _environ("X_FLAG", "enabled"),
            self.assertLogs("librephotos.env", logging.WARNING) as logs,
        ):
            self.assertFalse(env.env_flag("X_FLAG", default=True))
        self.assertIn("X_FLAG", logs.output[0])
        self.assertIn("enabled", logs.output[0])

    def test_unrecognised_value_before_logging_is_deferred(self):
        """The settings modules run before any handler exists; report later."""
        logging_bootstrap.take_deferred_warnings()
        root = logging.getLogger()
        with (
            patch.object(root, "handlers", []),
            _environ("X_FLAG", "t"),
        ):
            self.assertFalse(env.env_flag("X_FLAG", default=False))
        warnings = logging_bootstrap.take_deferred_warnings()
        self.assertEqual(1, len(warnings), warnings)
        self.assertIn("X_FLAG='t'", warnings[0])
        self.assertEqual([], env.take_warnings())

    def test_recognised_values_are_not_logged(self):
        with patch.object(env, "_warn") as warn:
            for value in FLAG_VALUES:
                if value in ("t", "nonsense"):
                    continue
                with _environ("X_FLAG", value):
                    env.env_flag("X_FLAG", default=True)
        warn.assert_not_called()


class EnvOptionalFlagTest(SimpleTestCase):
    def test_unset_blank_and_unrecognised_are_none(self):
        for value in (None, "", " "):
            with self.subTest(value=value), _environ("X_FLAG", value):
                self.assertIsNone(env.env_optional_flag("X_FLAG"))
        with (
            _environ("X_FLAG", "auto"),
            self.assertLogs("librephotos.env", logging.WARNING) as logs,
        ):
            self.assertIsNone(env.env_optional_flag("X_FLAG"))
        self.assertIn("X_FLAG", logs.output[0])

    def test_on_and_off(self):
        with _environ("X_FLAG", "Yes"):
            self.assertIs(True, env.env_optional_flag("X_FLAG"))
        with _environ("X_FLAG", "0"):
            self.assertIs(False, env.env_optional_flag("X_FLAG"))


class EnvIntTest(SimpleTestCase):
    def test_unset_and_blank_are_the_default(self):
        for value in (None, "", "   "):
            with self.subTest(value=value), _environ("X_INT", value):
                self.assertEqual(7, env.env_int("X_INT", 7))
                self.assertIsNone(env.env_int("X_INT", None))

    def test_valid(self):
        with _environ("X_INT", " 12 "):
            self.assertEqual(12, env.env_int("X_INT", 7))

    def test_invalid_names_the_variable(self):
        for value in ("twelve", "1.5", "0x10"):
            with self.subTest(value=value), _environ("X_INT", value):
                with self.assertRaisesMessage(env.EnvError, "X_INT"):
                    env.env_int("X_INT", 7)

    def test_error_is_a_value_error(self):
        """Django-free, and still caught by code that caught int()'s error."""
        self.assertTrue(issubclass(env.EnvError, ValueError))


class EnvFloatTest(SimpleTestCase):
    def test_unset_and_blank_are_the_default(self):
        for value in (None, "", " "):
            with self.subTest(value=value), _environ("X_FLOAT", value):
                self.assertEqual(2.5, env.env_float("X_FLOAT", 2.5))

    def test_valid(self):
        with _environ("X_FLOAT", "0.25"):
            self.assertEqual(0.25, env.env_float("X_FLOAT", 2))
        with _environ("X_FLOAT", "3"):
            self.assertEqual(3.0, env.env_float("X_FLOAT", 2))

    def test_invalid_names_the_variable(self):
        with _environ("X_FLOAT", "ten"):
            with self.assertRaisesMessage(env.EnvError, "X_FLOAT"):
                env.env_float("X_FLOAT", 2)


class EnvListTest(SimpleTestCase):
    def test_unset_is_the_default(self):
        with _environ("X_LIST", None):
            self.assertEqual([], env.env_list("X_LIST"))
            self.assertEqual(["a", "b"], env.env_list("X_LIST", ("a", "b")))

    def test_blank_is_an_empty_list(self):
        with _environ("X_LIST", ""):
            self.assertEqual([], env.env_list("X_LIST", ("a",)))

    def test_entries_are_stripped_and_blanks_dropped(self):
        with _environ("X_LIST", " a, b ,,c ,"):
            self.assertEqual(["a", "b", "c"], env.env_list("X_LIST"))


class ExportTest(SimpleTestCase):
    def test_sets_the_variable_for_this_process(self):
        with _environ("X_EXPORT", None):
            env.export("X_EXPORT", "value")
            self.assertEqual("value", env.env_str("X_EXPORT"))


class LegacyFlagParityTest(SimpleTestCase):
    """Old and new parsing agree on every value in FLAG_VALUES, bar the pins."""

    def _new_flag(self, value, **kwargs):
        with _environ("X_FLAG", value), patch.object(env, "_warn"):
            return env.env_flag("X_FLAG", **kwargs)

    def test_production_feature_switches(self):
        # FEATURE_*, NEXTCLOUD_ALLOW_PRIVATE_ADDRESSES: on by default.
        for value in FLAG_VALUES:
            with self.subTest(value=value):
                self.assertEqual(
                    legacy_env_flag(value), self._new_flag(value, default=True)
                )

    def test_demo_site(self):
        for value in FLAG_VALUES:
            with self.subTest(value=value):
                self.assertEqual(
                    legacy_env_flag(value, default=False),
                    self._new_flag(value, default=False),
                )

    def test_allow_upload(self):
        for value in FLAG_VALUES:
            with self.subTest(value=value):
                self.assertEqual(
                    legacy_env_flag(value, default=True, empty=True),
                    self._new_flag(value, default=True, empty=True),
                )

    def test_dev_windows_opt_in_switches(self):
        for value in FLAG_VALUES:
            with self.subTest(value=value):
                self.assertEqual(
                    legacy_opt_in(value), self._new_flag(value, default=False)
                )

    def test_nextcloud_enabled_drops_only_the_t_alias(self):
        for value in FLAG_VALUES:
            with self.subTest(value=value):
                new = self._new_flag(value, default=False)
                if value == "t":
                    self.assertTrue(legacy_nextcloud_enabled(value))
                    self.assertFalse(new)
                else:
                    self.assertEqual(legacy_nextcloud_enabled(value), new)

    def test_log_to_console(self):
        for value in FLAG_VALUES:
            with (
                self.subTest(value=value),
                _environ("LOG_TO_CONSOLE", value),
                patch.object(env, "_warn"),
            ):
                self.assertEqual(
                    legacy_log_to_console(value),
                    logging_bootstrap.resolve_to_console(),
                )

    def test_log_to_console_passed_as_a_string(self):
        for value in FLAG_VALUES:
            if value is None:
                continue
            with self.subTest(value=value), patch.object(env, "_warn"):
                self.assertEqual(
                    legacy_log_to_console(value),
                    logging_bootstrap.resolve_to_console(value),
                )

    def test_django_debug_now_also_takes_the_other_on_spellings(self):
        newly_on = {"true", "True", "TRUE", "yes", "on", " On "}
        for value in FLAG_VALUES:
            with self.subTest(value=value):
                new = self._new_flag(value, default=False)
                if value in newly_on:
                    self.assertFalse(legacy_django_debug(value))
                    self.assertTrue(new)
                else:
                    self.assertEqual(legacy_django_debug(value), new)

    def test_onnx_cpu_arena(self):
        from service.onnx_session import cpu_arena

        for value in (*FLAG_VALUES, "auto"):
            for variable_shapes in (False, True):
                with (
                    self.subTest(value=value, variable_shapes=variable_shapes),
                    _environ("ONNX_CPU_ARENA", value),
                    patch.object(env, "_warn"),
                ):
                    self.assertEqual(
                        legacy_onnx_cpu_arena(value, variable_shapes),
                        cpu_arena(variable_shapes),
                    )


class LegacyNumberParityTest(SimpleTestCase):
    def test_int_settings_agree_where_the_old_code_did_not_crash(self):
        # WEBSERVER_UID/GID, TRANSCODE_*, REFRESH_TOKEN_DAYS, WEB_THREADS and the
        # WORKER_CONCURRENCY of dev_windows/standalone were int(get(name, "N")).
        for value in NUMBER_VALUES:
            with self.subTest(value=value), _environ("X_INT", value):
                legacy = int(os.environ.get("X_INT", "101"))
                self.assertEqual(legacy, env.env_int("X_INT", 101))

    def test_float_settings_agree_where_the_old_code_did_not_crash(self):
        for value in (*NUMBER_VALUES, "0.5", " 2.5 "):
            with self.subTest(value=value), _environ("X_FLOAT", value):
                legacy = float(os.environ.get("X_FLOAT", "10"))
                self.assertEqual(legacy, env.env_float("X_FLOAT", 10))

    def test_blank_number_falls_back_instead_of_crashing(self):
        with _environ("X_INT", ""):
            with self.assertRaises(ValueError):
                int(os.environ.get("X_INT", "101"))
            self.assertEqual(101, env.env_int("X_INT", 101))

    def test_garbage_still_stops_the_process_but_names_the_variable(self):
        with _environ("X_INT", "ten"):
            with self.assertRaises(ValueError):
                int(os.environ.get("X_INT", "101"))
            with self.assertRaisesMessage(ValueError, "X_INT must be a whole number"):
                env.env_int("X_INT", 101)

    def test_production_worker_concurrency(self):
        for value in (*NUMBER_VALUES, ""):
            with self.subTest(value=value), _environ("X_INT", value):
                self.assertEqual(
                    legacy_worker_concurrency(value), env.env_int("X_INT", None)
                )

    def test_onnx_intra_op_threads(self):
        from service.onnx_session import intra_op_threads

        for value in (*NUMBER_VALUES, "", "   ", "many"):
            with self.subTest(value=value), _environ("ONNX_INTRA_OP_THREADS", value):
                legacy = legacy_onnx_intra_op_threads(value)
                expected = legacy if legacy is not None and legacy > 0 else None
                self.assertEqual(expected, intra_op_threads())


class LegacyListParityTest(SimpleTestCase):
    VALUES = (
        None,
        "",
        " ",
        "https://a.example.com",
        " https://a.example.com, https://b.example.com ,",
    )

    def test_noproxy_csrf_trusted_origins(self):
        for value in self.VALUES:
            with self.subTest(value=value), _environ("X_LIST", value):
                self.assertEqual(legacy_csrf_noproxy(value), env.env_list("X_LIST"))

    def test_standalone_csrf_trusted_origins(self):
        default = ["http://localhost:8000", "http://127.0.0.1:8000"]
        for value in self.VALUES:
            with self.subTest(value=value), _environ("X_LIST", value):
                self.assertEqual(
                    legacy_csrf_standalone(value), env.env_list("X_LIST", default)
                )


class ProductionSettingsThroughEnvTest(SimpleTestCase):
    """The moved settings, read the way Django reads them: by importing."""

    def setUp(self):
        self.addCleanup(importlib.reload, production)

    def _reload(self, **values):
        environment = {k: v for k, v in os.environ.items() if k not in values}
        environment.update({k: v for k, v in values.items() if v is not None})
        with patch.dict(os.environ, environment, clear=True):
            importlib.reload(production)
        return production

    def test_nextcloud_enabled(self):
        def enabled(value):
            module = self._reload(NEXTCLOUD_ENABLED=value)
            return module.CONSTANCE_CONFIG["NEXTCLOUD_ENABLED"][0]

        self.assertFalse(enabled(None))
        self.assertFalse(enabled(""))
        self.assertTrue(enabled("true"))
        self.assertTrue(enabled("1"))
        self.assertFalse(enabled("false"))
        # Release note: "t" used to switch the integration on.
        self.assertFalse(enabled("t"))

    def test_bad_number_names_the_variable(self):
        for name in (
            "WEBSERVER_UID",
            "TRANSCODE_CACHE_MAX_GB",
            "TRANSCODE_LIVE_BURST_SECONDS",
            "REFRESH_TOKEN_DAYS",
            "WORKER_CONCURRENCY",
        ):
            with self.subTest(name=name):
                with self.assertRaisesMessage(env.EnvError, name):
                    self._reload(**{name: "lots"})

    def test_worker_concurrency(self):
        self.assertNotIn("workers", self._reload(WORKER_CONCURRENCY=None).Q_CLUSTER)
        self.assertNotIn("workers", self._reload(WORKER_CONCURRENCY="").Q_CLUSTER)
        self.assertEqual(3, self._reload(WORKER_CONCURRENCY="3").Q_CLUSTER["workers"])

    def test_backend_host_feeds_allowed_and_internal_hosts(self):
        module = self._reload(BACKEND_HOST="api.internal")
        self.assertEqual(["localhost", "api.internal"], module.ALLOWED_HOSTS)
        self.assertEqual(frozenset({"backend", "api.internal"}), module.INTERNAL_HOSTS)
        module = self._reload(BACKEND_HOST=None)
        self.assertEqual(frozenset({"backend"}), module.INTERNAL_HOSTS)

    def test_build_identity(self):
        module = self._reload(IMAGE_TAG="2026w41", GIT_HASH="abc1234")
        self.assertEqual(("2026w41", "abc1234"), (module.IMAGE_TAG, module.GIT_HASH))
        module = self._reload(IMAGE_TAG=None, GIT_HASH=None)
        self.assertEqual(("", ""), (module.IMAGE_TAG, module.GIT_HASH))

    def test_db_pass_unset_and_blank_stay_distinct(self):
        module = self._reload(DB_PASS="")
        self.assertEqual("", module.DATABASES["default"]["PASSWORD"])
        self.assertTrue(module.DB_PASS_FROM_ENV)

    def test_mplconfigdir_is_exported_for_the_sidecars(self):
        environment = {k: v for k, v in os.environ.items() if k != "MPLCONFIGDIR"}
        with patch.dict(os.environ, environment, clear=True):
            importlib.reload(production)
            self.assertEqual(production.MPLCONFIGDIR, os.environ.get("MPLCONFIGDIR"))
