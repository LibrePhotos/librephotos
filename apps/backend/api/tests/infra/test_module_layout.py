"""Backend code lives in a domain package under ``api/``, not in a flat module.

Issue #2335: a new flat ``api/*.py`` module fails here. The only flat modules
are the Django and project conventions in ``STAYS_FLAT``, and the list only
shrinks: a convention module that goes away must leave the list in the same
pull request, or the test fails on the stale entry.

A move into a package updates every import and every
``mock.patch("api.<old>...")`` string and leaves no re-export shim behind: a
test that patches a shim no longer patches the code under test.

The domain packages are also a layer of the import contracts in
``pyproject.toml`` (``[tool.importlinter]``, checked by ``lint-imports``): a
new package under ``api/`` is added there, which this test checks too.
"""

import tomllib
from pathlib import Path

from django.test import SimpleTestCase

from api.tests.stubs import BACKEND_ROOT, load_backend_file, unique_module_name

API = BACKEND_ROOT / "api"

# Django and project conventions: these stay flat.
STAYS_FLAT = {
    "__init__",
    "admin",
    "apps",
    "checks",
    "lazy_import",
    "mime",
    "sync_signals",  # where it ends up is #2342
}

# Packages under api/ that are not domain packages: the layers above and below
# them, and Django's own directories.
NOT_DOMAIN_PACKAGES = {
    "views",
    "serializers",
    "models",
    "migrations",
    "management",
    "tests",
}


def flat_modules(api_dir: Path) -> set[str]:
    return {path.stem for path in api_dir.glob("*.py")}


def layout_problems(found: set[str]) -> list[str]:
    problems = [
        f"api/{name}.py is a new flat module: put it in a domain package "
        "(see 'Layout' in apps/backend/AGENTS.md)"
        for name in sorted(found - STAYS_FLAT)
    ]
    problems += [
        f"api/{name}.py is gone: remove it from STAYS_FLAT in {Path(__file__).name}"
        for name in sorted(STAYS_FLAT - found)
    ]
    return problems


def domain_packages(api_dir: Path) -> set[str]:
    return {
        f"api.{path.parent.name}"
        for path in api_dir.glob("*/__init__.py")
        if path.parent.name not in NOT_DOMAIN_PACKAGES
    }


class ModuleLayoutTest(SimpleTestCase):
    def test_no_new_flat_module_and_no_stale_entry(self):
        self.assertEqual(layout_problems(flat_modules(API)), [])

    def test_a_planted_flat_module_fails(self):
        found = STAYS_FLAT | {"new_module"}
        self.assertEqual(
            [problem.split(" ")[0] for problem in layout_problems(found)],
            ["api/new_module.py"],
        )

    def test_a_removed_convention_module_still_listed_fails(self):
        found = STAYS_FLAT - {"lazy_import"}
        self.assertEqual(
            [problem.split(" ")[0] for problem in layout_problems(found)],
            ["api/lazy_import.py"],
        )


class ImportContractsTest(SimpleTestCase):
    def _contracts(self) -> dict[str, dict[str, object]]:
        config = tomllib.loads(
            (BACKEND_ROOT / "pyproject.toml").read_text(encoding="utf-8")
        )
        return {c["id"]: c for c in config["tool"]["importlinter"]["contracts"]}

    def test_every_domain_package_is_a_layer(self):
        layers = self._contracts()["layers"]["layers"]
        assert isinstance(layers, list)
        domain_layer = {name.strip() for name in layers[2].split(":")}
        self.assertEqual(domain_layer, domain_packages(API))


class ImportContractsBaselineTest(SimpleTestCase):
    """scripts/import_contracts_baseline.py: an ignore_imports entry is only removed."""

    @classmethod
    def setUpClass(cls) -> None:
        super().setUpClass()
        ruff_baseline = load_backend_file(
            "scripts/ruff_baseline.py", name=unique_module_name("_ruff_baseline")
        )
        cls.script = load_backend_file(
            "scripts/import_contracts_baseline.py",
            name=unique_module_name("_import_contracts_baseline"),
            stubs={"ruff_baseline": ruff_baseline},
        )

    PYPROJECT = """
[tool.importlinter]
root_packages = ["api"]

[[tool.importlinter.contracts]]
id = "layers"
name = "Layers"
type = "layers"
layers = ["api.views", "api.models"]
ignore_imports = [{entries}]
"""

    def _parse(self, *entries: str, layers: str = '"api.views", "api.models"'):
        text = self.PYPROJECT.format(entries=", ".join(f'"{e}"' for e in entries))
        return self.script.parse_contracts(
            text.replace('"api.views", "api.models"', layers)
        )

    def test_a_new_entry_is_growth_and_a_removed_one_is_not(self):
        old, _ = self._parse(
            "api.models.a -> api.views.b", "api.models.c -> api.views.d"
        )
        current, _ = self._parse(
            "api.models.a -> api.views.b", "api.models.e->api.views.f"
        )
        self.assertEqual(
            self.script.grown_entries(current, old, {}),
            [("layers", "api.models.e -> api.views.f")],
        )

    def test_a_moved_module_keeps_its_entry(self):
        old, _ = self._parse("api.models.user -> api.date_time_extractor")
        current, _ = self._parse("api.models.user -> api.metadata.datetime_rules")
        renames = self.script.renamed_modules(
            {"api/metadata/datetime_rules.py": "api/date_time_extractor.py"}
        )
        self.assertEqual(self.script.grown_entries(current, old, renames), [])

    def test_a_renamed_package_renames_its_modules(self):
        renames = self.script.renamed_modules({"api/runtime/__init__.py": "api/x.py"})
        self.assertEqual(
            self.script.old_module("api.runtime.sidecars", renames), "api.x.sidecars"
        )
        self.assertEqual(
            self.script.old_module("api.runtimes", renames), "api.runtimes"
        )

    def test_a_changed_contract_definition_is_reported(self):
        _, old = self._parse()
        _, same = self._parse()
        _, changed = self._parse(layers='"api.views", "api.photos", "api.models"')
        self.assertEqual(old, same)
        self.assertNotEqual(old, changed)
