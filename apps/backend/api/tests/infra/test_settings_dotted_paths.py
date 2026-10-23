"""Every dotted path the settings modules name in the project resolves.

Settings name classes and functions by string (``DEFAULT_PAGINATION_CLASS``,
``DEFAULT_SCHEMA_CLASS``, the schema postprocessing hooks, ``EXCEPTION_HANDLER``,
``EMAIL_BACKEND``, the allauth adapters, ``ROOT_URLCONF``...). Django and DRF
import them on first use, so a path a module move forgot to update fails at
runtime, often only on the request that needs it, never at import (#2335).

This reads the string literals of every module in ``librephotos/settings/``
(not only the one the tests run with) and imports each one that starts with
a project package: as a module, as a module attribute, or as a model label
(``AUTH_USER_MODEL = "api.User"``).
"""

import ast
import importlib.util
from importlib import import_module
from pathlib import Path

from django.apps import apps
from django.test import SimpleTestCase
from django.utils.module_loading import import_string

from api.tests.stubs import BACKEND_ROOT

SETTINGS_DIR = BACKEND_ROOT / "librephotos" / "settings"

PROJECT_PACKAGES = {"api", "nextcloud", "librephotos", "chunked_upload"}

# Importing these builds the application (and sets up logging again), so they
# are looked up in the source instead.
ENTRY_MODULES = {"librephotos.wsgi", "librephotos.asgi"}

# Dotted strings that are not import paths.
NOT_PATHS = {
    "librephotos.sqlite3",  # production_noproxy's SQLite database file
}


def _is_dotted(value: str) -> bool:
    parts = value.split(".")
    return len(parts) > 1 and all(part.isidentifier() for part in parts)


def project_dotted_strings(settings_dir: Path) -> dict[str, set[str]]:
    """Dotted string literal -> the settings files it appears in."""
    found: dict[str, set[str]] = {}
    for path in sorted(settings_dir.glob("*.py")):
        tree = ast.parse(path.read_text(encoding="utf-8"))
        for node in ast.walk(tree):
            if not (isinstance(node, ast.Constant) and isinstance(node.value, str)):
                continue
            value = node.value
            if _is_dotted(value) and value.split(".")[0] in PROJECT_PACKAGES:
                found.setdefault(value, set()).add(path.name)
    return found


def _top_level_names(module: str) -> set[str]:
    spec = importlib.util.find_spec(module)
    if spec is None or spec.origin is None:
        return set()
    tree = ast.parse(Path(spec.origin).read_text(encoding="utf-8"))
    names: set[str] = set()
    for node in tree.body:
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
            names.add(node.name)
        elif isinstance(node, ast.Assign):
            names.update(t.id for t in node.targets if isinstance(t, ast.Name))
        elif isinstance(node, ast.AnnAssign) and isinstance(node.target, ast.Name):
            names.add(node.target.id)
    return names


def resolves(path: str) -> bool:
    module, _, name = path.rpartition(".")
    if module in ENTRY_MODULES:
        return name in _top_level_names(module)
    try:
        import_module(path)
        return True
    except ImportError:
        pass
    try:
        import_string(path)
        return True
    except ImportError:
        pass
    try:
        apps.get_model(path)
        return True
    except LookupError, ValueError:
        return False


class SettingsDottedPathsTest(SimpleTestCase):
    def test_every_project_path_in_the_settings_resolves(self):
        broken = {
            path: sorted(files)
            for path, files in project_dotted_strings(SETTINGS_DIR).items()
            if path not in NOT_PATHS and not resolves(path)
        }
        self.assertEqual(broken, {}, "settings name a path that does not import")

    def test_the_scan_sees_the_settings_paths(self):
        found = project_dotted_strings(SETTINGS_DIR)
        for path in (
            "api.drf.pagination.DefaultPagination",
            "api.drf.openapi.AutoSchema",
            "api.drf.openapi.require_page_keys",
            "api.views.exception_handler.custom_exception_handler",
            "api.accounts.mail.DynamicEmailBackend",
            "api.accounts.adapters.SSOSocialAccountAdapter",
            "api.accounts.adapters.NoLocalSignupAccountAdapter",
            "librephotos.urls",
            "librephotos.wsgi.application",
            "api.User",
        ):
            with self.subTest(path=path):
                self.assertIn(path, found)
                self.assertTrue(resolves(path))

    def test_a_stale_path_does_not_resolve(self):
        for path in (
            "api.mail.DynamicEmailBackend",  # the module moved
            "api.drf.pagination.NoSuchPagination",  # the module has no such name
            "librephotos.wsgi.app",
            "api.NoSuchModel",
        ):
            with self.subTest(path=path):
                self.assertFalse(resolves(path))

    def test_every_exception_is_still_in_the_settings(self):
        self.assertLessEqual(NOT_PATHS, set(project_dotted_strings(SETTINGS_DIR)))
