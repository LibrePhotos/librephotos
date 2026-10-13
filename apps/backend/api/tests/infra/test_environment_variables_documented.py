"""Every environment variable LibrePhotos reads is documented, or listed as internal.

The operator-facing reference is ``apps/docs/docs/installation/environment-variables.md``.
This guard collects the variables the code reads and checks each one is either
mentioned on that page (as ``NAME`` or ``NAME=...`` in backticks) or listed in
``INTERNAL_ENV_VARS`` below with the reason it stays off the page. A new
variable therefore needs a row or a sentence on the page, or an entry here.

Where a variable is read:

* the backend's Python (``apps/backend``, minus tests and migrations): calls to
  the helpers of ``librephotos/env.py`` and to ``os.environ`` / ``os.getenv``
  with a literal name or a module-level constant;
* the entrypoints under ``deploy/docker/``: ``$NAME`` and ``${NAME...}``;
* ``deploy/k8s/config/*.env``: the names it sets.

``deploy/compose/*.yml`` is checked differently: each ``${key}`` it fills in from
the .env file must be defined in ``librephotos.env`` (commented out is enough) or
mentioned on the page. Those keys are the operator's .env names, not variables
the backend reads.

Without the repository checkout (inside the backend Docker image) the checks
against ``deploy/`` and the docs page are skipped; the detection tests still run.
"""

import ast
import os
import re
import unittest
from collections.abc import Iterator
from pathlib import Path

from django.test import SimpleTestCase

from api.tests.infra.deploy_files import (
    BACKEND_ROOT,
    DEPLOY_DIR,
    ENV_PAGE,
    REPO_ROOT,
    compose_interpolated_keys,
    env_file_keys,
    repository_present,
    shell_read_names,
)

ENV_MODULE = "librephotos.env"
# The helpers of librephotos/env.py that read a variable; the first argument is its name.
ENV_HELPERS = frozenset(
    {
        "env_str",
        "env_flag",
        "env_optional_flag",
        "env_int",
        "env_float",
        "env_list",
        "parse_flag",
    }
)
EXCLUDED_DIRS = frozenset({"tests", "migrations", "node_modules", "__pycache__"})
# The parser itself reads ``os.environ`` with the name it was given.
PARSER_MODULE = "librephotos/env.py"

# Variables read by the code or the entrypoints that operators do not set, with
# the reason they stay off the environment-variables page. Each entry must still
# be read somewhere (test_internal_entries_are_still_read).
INTERNAL_ENV_VARS = {
    "DJANGO_DEBUG": "Selects the native Windows development settings (librephotos/settings/dev_windows.py); no container uses it.",
    "DJANGO_SETTINGS_MODULE": "Picked by manage.py, wsgi.py and the entrypoints from DEBUG and the image; a settings module, not a knob.",
    "GIT_HASH": "Build argument of the images, reported by the server info endpoint (api/views/server_info.py).",
    "GITHUB_SHA": "Read by scripts/build_standalone.py in CI to name the build, not by the server.",
    "IMAGE_TAG": "Build argument of the images, reported as the running version (api/views/server_info.py).",
    "LIBREPHOTOS_CONSOLE_LOG": "Set by the Windows standalone launcher to point its console log at a file.",
    "LOCALAPPDATA": "Windows only: the standalone launcher's default data folder comes from it.",
    "MPLCONFIGDIR": "Matplotlib's cache directory; the images set it under BASE_DATA before anything imports matplotlib.",
    "NO_COVERAGE": "Test runs only: manage.py skips coverage when it is set.",
    "OCR_MODEL_DIR": "Test and local-export override for an OCR model bundle (service/ocr/ppocr/config.py).",
    "OPENCLIP_MODEL_DIR": "Test and local-export override for an OpenCLIP bundle (service/tags/openclip/openclip.py).",
    "PATH": "Read by the Windows standalone launcher to build its child processes' environment.",
    "PYTHONPATH": "Extended by api/runtime/supervisor.py for the sidecar processes it starts; the sidecars use it, not operators.",
    "XDG_DATA_HOME": "The standalone launcher's default data folder on Linux, from the desktop session.",
}

# ${key} names that compose files fill in but that are not backend variables.
COMPOSE_ONLY_KEYS = {
    "PGADMIN_DEFAULT_EMAIL": "Settings of the pgAdmin image in the development stack (docker-compose.dev.yml).",
    "PGADMIN_DEFAULT_PASSWORD": "Settings of the pgAdmin image in the development stack (docker-compose.dev.yml).",
}

EnvRead = tuple[str | None, str]


def backend_python_files() -> Iterator[Path]:
    """The backend's Python modules that are not tests, migrations or the parser."""
    for dirpath, dirnames, filenames in os.walk(BACKEND_ROOT):
        dirnames[:] = [
            d for d in dirnames if d not in EXCLUDED_DIRS and not d.startswith(".")
        ]
        for name in filenames:
            if not name.endswith(".py") or name == "tests.py":
                continue
            path = Path(dirpath) / name
            if path.relative_to(BACKEND_ROOT).as_posix() == PARSER_MODULE:
                continue
            yield path


def _env_bindings(tree: ast.AST) -> tuple[set[str], set[str]]:
    """Local names bound to an env helper, and local names bound to librephotos.env."""
    helpers: set[str] = set()
    env_modules: set[str] = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.ImportFrom) and node.module == ENV_MODULE:
            helpers.update(
                alias.asname or alias.name
                for alias in node.names
                if alias.name in ENV_HELPERS
            )
        elif isinstance(node, ast.ImportFrom) and node.module == "librephotos":
            env_modules.update(
                alias.asname or alias.name
                for alias in node.names
                if alias.name == "env"
            )
        elif isinstance(node, ast.Import):
            env_modules.update(
                alias.asname
                for alias in node.names
                if alias.name == ENV_MODULE and alias.asname
            )
    return helpers, env_modules


def _string_constants(tree: ast.Module) -> dict[str, str]:
    """Module-level `NAME = "literal"` assignments."""
    constants: dict[str, str] = {}
    for node in tree.body:
        if (
            isinstance(node, ast.Assign)
            and len(node.targets) == 1
            and isinstance(node.targets[0], ast.Name)
            and isinstance(node.value, ast.Constant)
            and isinstance(node.value.value, str)
        ):
            constants[node.targets[0].id] = node.value.value
    return constants


def _is_name(node: ast.expr, name: str) -> bool:
    return isinstance(node, ast.Name) and node.id == name


def _is_os_environ(node: ast.expr) -> bool:
    return (
        isinstance(node, ast.Attribute)
        and node.attr == "environ"
        and _is_name(node.value, "os")
    )


def _is_env_call(func: ast.expr, helpers: set[str], env_modules: set[str]) -> bool:
    """env_str(...), env.env_str(...), os.environ.get(...) or os.getenv(...)."""
    if isinstance(func, ast.Name):
        return func.id in helpers
    if not isinstance(func, ast.Attribute):
        return False
    if func.attr in ENV_HELPERS and isinstance(func.value, ast.Name):
        return func.value.id in env_modules
    if func.attr == "get":
        return _is_os_environ(func.value)
    return func.attr == "getenv" and _is_name(func.value, "os")


def _read_name_node(
    node: ast.AST, helpers: set[str], env_modules: set[str]
) -> ast.expr | None:
    """The expression naming the variable when `node` reads the environment."""
    if isinstance(node, ast.Call):
        if node.args and _is_env_call(node.func, helpers, env_modules):
            return node.args[0]
    elif isinstance(node, ast.Subscript):
        if isinstance(node.ctx, ast.Load) and _is_os_environ(node.value):
            return node.slice
    elif isinstance(node, ast.Compare):
        if (
            len(node.ops) == 1
            and isinstance(node.ops[0], (ast.In, ast.NotIn))
            and _is_os_environ(node.comparators[0])
        ):
            return node.left
    return None


def python_env_reads(source: str, where: str) -> list[EnvRead]:
    """The variables a module reads: (name, location), name None when not a literal."""
    tree = ast.parse(source, filename=where)
    helpers, env_modules = _env_bindings(tree)
    constants = _string_constants(tree)

    def literal(arg: ast.expr) -> str | None:
        if isinstance(arg, ast.Constant) and isinstance(arg.value, str):
            return arg.value
        if isinstance(arg, ast.Name):
            return constants.get(arg.id)
        return None

    reads: list[EnvRead] = []
    for node in ast.walk(tree):
        name_node = _read_name_node(node, helpers, env_modules)
        if name_node is not None:
            reads.append((literal(name_node), f"{where}:{getattr(node, 'lineno', 0)}"))
    return reads


def backend_reads() -> tuple[dict[str, set[str]], list[str]]:
    """Names read by the backend's Python, with where, and the reads that were not literal."""
    names: dict[str, set[str]] = {}
    unresolved: list[str] = []
    for path in backend_python_files():
        rel = path.relative_to(BACKEND_ROOT).as_posix()
        source = path.read_text(encoding="utf-8")
        for name, where in python_env_reads(source, rel):
            if name is None:
                unresolved.append(where)
            else:
                names.setdefault(name, set()).add(where)
    return names, unresolved


def _relative(path: Path) -> str:
    return path.relative_to(REPO_ROOT).as_posix()


def entrypoint_reads() -> dict[str, set[str]]:
    names: dict[str, set[str]] = {}
    for path in sorted((DEPLOY_DIR / "docker").rglob("entrypoint*.sh")):
        for name in shell_read_names(path.read_text(encoding="utf-8")):
            names.setdefault(name, set()).add(_relative(path))
    return names


def k8s_names() -> dict[str, set[str]]:
    names: dict[str, set[str]] = {}
    for path in sorted((DEPLOY_DIR / "k8s" / "config").glob("*.env")):
        for name in env_file_keys(path.read_text(encoding="utf-8")):
            if name.isupper():
                names.setdefault(name, set()).add(_relative(path))
    return names


def documented_names(page: str) -> set[str]:
    """Upper-case variables the page mentions as ``NAME`` or ``NAME=...``."""
    return set(re.findall(r"`([A-Z][A-Z0-9_]*)(?:=[^`]*)?`", page))


def documented_tokens(page: str) -> set[str]:
    """Any name the page mentions in backticks, including .env keys such as ``workerConcurrency``."""
    return set(re.findall(r"`([A-Za-z_][A-Za-z0-9_]*)(?:=[^`]*)?`", page))


def table_names(page: str) -> set[str]:
    """Upper-case variables that start a table row (``| `NAME` | ...``)."""
    return set(re.findall(r"^\|\s*`([A-Z][A-Z0-9_]*)`\s*\|", page, re.MULTILINE))


def all_read_names() -> dict[str, set[str]]:
    """Every name the backend, its entrypoints or the k8s config reads or sets, with where."""
    names, _ = backend_reads()
    merged = {name: set(where) for name, where in names.items()}
    for source in (entrypoint_reads(), k8s_names()):
        for name, where in source.items():
            merged.setdefault(name, set()).update(where)
    return merged


class EnvReadDetectionTest(SimpleTestCase):
    """The detector itself, on planted snippets: it must see what the guard relies on."""

    def names(self, source: str) -> list[str | None]:
        return [name for name, _ in python_env_reads(source, "planted.py")]

    def test_os_environ_get_is_a_read(self):
        self.assertEqual(
            ["SOME_NEW_KNOB"],
            self.names('import os\nx = os.environ.get("SOME_NEW_KNOB")\n'),
        )

    def test_subscript_and_getenv_are_reads(self):
        self.assertEqual(
            ["A_NAME", "B_NAME"],
            self.names('import os\nos.environ["A_NAME"]\nos.getenv("B_NAME")\n'),
        )

    def test_membership_test_is_a_read(self):
        self.assertEqual(
            ["C_NAME"], self.names('import os\nok = "C_NAME" in os.environ\n')
        )

    def test_helpers_imported_from_env_are_reads(self):
        source = (
            "from librephotos.env import env_int, env_flag\n"
            'env_int("WEB_THREADS", 16)\n'
            'env_flag("FEATURE_VIDEO", default=True)\n'
        )
        self.assertEqual(["WEB_THREADS", "FEATURE_VIDEO"], self.names(source))

    def test_helpers_reached_through_the_module_are_reads(self):
        source = 'from librephotos import env\nenv.env_str("BASE_LOGS")\nenv.parse_flag("LOG_TO_CONSOLE", raw)\n'
        self.assertEqual(["BASE_LOGS", "LOG_TO_CONSOLE"], self.names(source))

    def test_a_same_named_function_is_not_a_read(self):
        self.assertEqual([], self.names("def f(q):\n    return parse_flag(q)\n"))

    def test_module_constant_names_resolve(self):
        source = (
            "import os\nfrom librephotos.env import env_str\n"
            'MODEL_DIR_ENV = "OCR_MODEL_DIR"\n'
            "env_str(MODEL_DIR_ENV)\nos.environ.get(MODEL_DIR_ENV)\n"
        )
        self.assertEqual(["OCR_MODEL_DIR", "OCR_MODEL_DIR"], self.names(source))

    def test_a_dynamic_name_is_reported_not_skipped(self):
        self.assertEqual([None], self.names("import os\nos.getenv(name)\n"))

    def test_writes_are_not_reads(self):
        """A value the process sets for itself or its children is not operator configuration."""
        self.assertEqual(
            [],
            self.names(
                'import os\nos.environ["X_WRITE"] = "1"\n'
                'os.environ.setdefault(NAME, "1")\n'
            ),
        )

    def test_entrypoint_variable_is_found(self):
        script = (
            "# Note: $COMMENTED is only mentioned\n"
            'echo "${NEW_VAR:-x}" "$OTHER_VAR"\nlocal=1\necho "$local"\nexport FOO=bar\n'
        )
        self.assertEqual({"NEW_VAR", "OTHER_VAR"}, shell_read_names(script))

    def test_compose_interpolation_is_found(self):
        self.assertEqual(
            {"newKey", "tag"},
            compose_interpolated_keys("- X=${newKey:-}\nimage: a:${tag}\n"),
        )

    def test_env_file_keys_include_commented_ones(self):
        self.assertEqual(
            {"logLevel", "tag"},
            env_file_keys("# logLevel=INFO\ntag=latest\n# A sentence with no key.\n"),
        )


@unittest.skipUnless(
    repository_present(), "needs the repository checkout (deploy/ and the docs page)"
)
class EnvironmentVariablesDocumentedTest(SimpleTestCase):
    def setUp(self):
        super().setUp()
        self.page = ENV_PAGE.read_text(encoding="utf-8")
        self.reads = all_read_names()

    def test_python_reads_are_all_literal(self):
        """A name built at run time cannot be checked; read it with a literal or a constant."""
        _, unresolved = backend_reads()
        self.assertEqual([], unresolved)

    def test_scanner_sees_the_variables_it_must_see(self):
        for name in (
            "WEB_THREADS",
            "BASE_LOGS",
            "FEATURE_VIDEO",
            "WORKER_CONCURRENCY",
            "OCR_MODEL_DIR",  # read through a module constant
            "SERVE_FRONTEND",  # read only by the entrypoint's unified block
            "WEB_CONCURRENCY",  # read only by the entrypoints
        ):
            with self.subTest(name=name):
                self.assertIn(name, self.reads)

    def test_every_variable_read_is_documented_or_internal(self):
        documented = documented_names(self.page)
        missing = sorted(
            name
            for name in self.reads
            if name not in documented and name not in INTERNAL_ENV_VARS
        )
        self.assertEqual(
            [],
            missing,
            "Not on the environment-variables page and not in INTERNAL_ENV_VARS: "
            + "; ".join(
                f"{name} (read in {sorted(self.reads[name])[0]})" for name in missing
            ),
        )

    def test_internal_entries_are_still_read(self):
        stale = sorted(set(INTERNAL_ENV_VARS) - set(self.reads))
        self.assertEqual([], stale, "INTERNAL_ENV_VARS entries nothing reads any more")

    def test_internal_entries_have_a_one_line_reason(self):
        for name, reason in INTERNAL_ENV_VARS.items():
            with self.subTest(name=name):
                self.assertTrue(reason.strip())
                self.assertNotIn("\n", reason)

    def test_debug_has_its_own_table_row(self):
        """DEBUG is also named in the LOG_LEVEL row, so a plain mention proves nothing."""
        self.assertIn("DEBUG", table_names(self.page))

    def test_compose_keys_are_defined_or_documented(self):
        env_keys = env_file_keys(
            (DEPLOY_DIR / "compose" / "librephotos.env").read_text(encoding="utf-8")
        )
        tokens = documented_tokens(self.page)
        compose_files = sorted((DEPLOY_DIR / "compose").glob("*.yml"))
        self.assertTrue(compose_files)
        problems = []
        used: set[str] = set()
        for path in compose_files:
            keys = compose_interpolated_keys(path.read_text(encoding="utf-8"))
            used |= keys
            for key in sorted(keys):
                if key in COMPOSE_ONLY_KEYS:
                    continue
                if key not in env_keys and key not in tokens:
                    problems.append(f"{key} ({_relative(path)})")
        self.assertEqual([], problems, "Compose keys with no .env line and no docs")
        self.assertEqual(
            [], sorted(set(COMPOSE_ONLY_KEYS) - used), "COMPOSE_ONLY_KEYS nothing uses"
        )
