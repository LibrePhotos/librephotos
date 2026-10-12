"""Test modules sit where CI runs them, and stub modules only through ``api/tests/stubs.py``.

test-backend.yml runs ``manage.py test api.tests nextcloud``. Django's runner
finds ``test*.py`` only under those two packages, so a test module anywhere else
never runs (``service/thumbnail/test/`` did not for years). The runner is
Django's, so ``pytest`` imports have no place in the backend either.

Stand-ins for module names and sidecar files go through ``stub_modules`` and
``load_backend_file`` in ``api/tests/stubs.py``, which put back exactly what they
changed. A direct write to ``sys.modules`` in a test module can leave a fake
module behind for every later test in the process.

Each checker is exercised on planted source first, so a checker that stops
detecting its violation fails here and not silently.
"""

import ast
import os
from collections.abc import Iterable, Iterator
from pathlib import Path, PurePosixPath

from django.test import SimpleTestCase

from api.tests.stubs import BACKEND_ROOT

# The packages the CI label list covers, as backend-relative posix paths.
CI_TEST_PACKAGES = ("api/tests", "nextcloud")
STUB_HELPER = "api/tests/stubs.py"
SETTINGS_PACKAGE = ("librephotos", "settings")
PRUNED_DIR_NAMES = {"__pycache__", "node_modules", "site-packages", "venv", "htmlcov"}
PYTEST_ROOTS = {"pytest", "_pytest"}
SYS_MODULES_MUTATORS = {"pop", "setdefault", "update", "clear", "popitem"}

# Test modules that register themselves in sys.modules while they import, under
# a name nothing else uses, because dataclasses looks the module up in
# sys.modules during class creation. They predate the helper. Each entry must
# still write sys.modules (checked below), so the list shrinks as they move.
REGISTERS_OWN_MODULE = {
    "api/tests/infra/test_check_dead_code.py",
    "api/tests/infra/test_ruff_config.py",
    "api/tests/infra/test_test_data_factories.py",
    "api/tests/infra/test_typecheck_ratchet.py",
}


def _is_sys_modules(node: ast.expr) -> bool:
    return (
        isinstance(node, ast.Attribute)
        and node.attr == "modules"
        and isinstance(node.value, ast.Name)
        and node.value.id == "sys"
    )


def sys_modules_writes(source: str) -> list[int]:
    """Line numbers of the statements in *source* that change ``sys.modules``."""
    lines: list[int] = []
    for node in ast.walk(ast.parse(source)):
        targets: list[ast.expr] = []
        if isinstance(node, ast.Assign):
            targets = list(node.targets)
        elif isinstance(node, ast.AugAssign | ast.AnnAssign):
            targets = [node.target]
        elif isinstance(node, ast.Delete):
            targets = list(node.targets)
        for target in targets:
            if isinstance(target, ast.Subscript) and _is_sys_modules(target.value):
                lines.append(node.lineno)
        if (
            isinstance(node, ast.Call)
            and isinstance(node.func, ast.Attribute)
            and node.func.attr in SYS_MODULES_MUTATORS
            and _is_sys_modules(node.func.value)
        ):
            lines.append(node.lineno)
    return sorted(set(lines))


def pytest_imports(source: str) -> list[int]:
    """Line numbers of the ``import pytest`` / ``from pytest import ...`` statements in *source*."""
    lines: list[int] = []
    for node in ast.walk(ast.parse(source)):
        if isinstance(node, ast.Import):
            roots = {alias.name.split(".")[0] for alias in node.names}
        elif isinstance(node, ast.ImportFrom) and node.module and not node.level:
            roots = {node.module.split(".")[0]}
        else:
            continue
        if roots & PYTEST_ROOTS:
            lines.append(node.lineno)
    return sorted(lines)


def is_test_module_name(name: str) -> bool:
    """Django's default pattern: ``test*.py``, which also covers ``tests.py``."""
    return name.startswith("test") and name.endswith(".py")


def is_discovered(relative: PurePosixPath) -> bool:
    """Whether the CI label list reaches a module at *relative*."""
    parts = relative.parts
    return any(
        parts[: len(package.split("/"))] == tuple(package.split("/"))
        for package in CI_TEST_PACKAGES
    )


def misplaced_test_modules(files: Iterable[PurePosixPath]) -> list[str]:
    """Test modules outside the CI packages, except the settings modules that share the name."""
    return [
        str(path)
        for path in files
        if is_test_module_name(path.name)
        and not is_discovered(path)
        and path.parts[:2] != SETTINGS_PACKAGE
    ]


def backend_files(suffix: str) -> Iterator[PurePosixPath]:
    """Backend files ending in *suffix*, skipping virtualenvs and caches (dot-directories included)."""
    for dirpath, dirnames, filenames in os.walk(BACKEND_ROOT):
        dirnames[:] = [
            name
            for name in dirnames
            if not name.startswith(".") and name not in PRUNED_DIR_NAMES
        ]
        for filename in filenames:
            if filename.endswith(suffix):
                relative = Path(dirpath, filename).relative_to(BACKEND_ROOT)
                yield PurePosixPath(relative.as_posix())


def _read(relative: PurePosixPath) -> str:
    return (BACKEND_ROOT / relative).read_text(encoding="utf-8")


class TestSuiteLayoutTest(SimpleTestCase):
    def test_a_direct_sys_modules_write_is_flagged(self):
        planted = [
            'sys.modules["x"] = module\n',
            'del sys.modules["x"]\n',
            'sys.modules.pop("x", None)\n',
            'sys.modules.setdefault("x", module)\n',
            'sys.modules.update({"x": module})\n',
        ]
        for source in planted:
            with self.subTest(source=source):
                self.assertEqual(sys_modules_writes(source), [1])

    def test_reads_and_patch_dict_are_not_flagged(self):
        clean = [
            'found = sys.modules.get("x")\n',
            'module = sys.modules["x"]\n',
            'with patch.dict("sys.modules", {"x": module}):\n    pass\n',
        ]
        for source in clean:
            with self.subTest(source=source):
                self.assertEqual(sys_modules_writes(source), [])

    def test_a_test_module_outside_the_ci_packages_is_flagged(self):
        files = [
            PurePosixPath("api/feature/tests/test_planted.py"),
            PurePosixPath("service/thumbnail/test/test_worker.py"),
            PurePosixPath("api/tests/infra/test_fine.py"),
            PurePosixPath("nextcloud/tests.py"),
            PurePosixPath("librephotos/settings/test_sqlite.py"),
        ]

        self.assertEqual(
            misplaced_test_modules(files),
            [
                "api/feature/tests/test_planted.py",
                "service/thumbnail/test/test_worker.py",
            ],
        )

    def test_pytest_imports_are_flagged(self):
        for source in ["import pytest\n", "from pytest import fixture\n"]:
            with self.subTest(source=source):
                self.assertEqual(pytest_imports(source), [1])
        self.assertEqual(pytest_imports("import pytest_django\n"), [])

    def test_no_test_module_writes_sys_modules_outside_the_helper(self):
        offenders: dict[str, list[int]] = {}
        for relative in backend_files(".py"):
            if relative.parts[:2] != ("api", "tests") and relative.parts[:1] != (
                "nextcloud",
            ):
                continue
            if str(relative) == STUB_HELPER:
                continue
            lines = sys_modules_writes(_read(relative))
            if lines and str(relative) not in REGISTERS_OWN_MODULE:
                offenders[str(relative)] = lines
        self.assertEqual(offenders, {}, "use api/tests/stubs.py instead")

    def test_registering_exceptions_still_write_sys_modules(self):
        # A fixed entry that no longer writes sys.modules has moved to the helper.
        stale = [
            path
            for path in sorted(REGISTERS_OWN_MODULE)
            if not sys_modules_writes(_read(PurePosixPath(path)))
        ]
        self.assertEqual(stale, [], "remove these from REGISTERS_OWN_MODULE")

    def test_every_test_module_is_in_a_ci_package(self):
        self.assertEqual(misplaced_test_modules(backend_files(".py")), [])

    def test_no_backend_module_imports_pytest(self):
        offenders = {
            str(relative): lines
            for relative in backend_files(".py")
            if (lines := pytest_imports(_read(relative)))
        }
        self.assertEqual(
            offenders, {}, "the runner is Django's: use unittest/django.test"
        )
