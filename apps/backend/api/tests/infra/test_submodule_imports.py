"""A module that uses ``PIL.Image`` imports ``PIL.Image``, not just ``PIL``.

``import PIL`` does not load ``PIL.Image``: the attribute only exists once some
other module has imported it. A module relying on that works in the full test
run and in a busy server process, and fails in a process that never loaded it,
where ``api.metadata.face_regions`` swallowed the AttributeError and wrote no
face tags, and test modules failed when run alone or under ``--parallel``.

This walks every backend module, tests included, and fails on a ``PIL.<Sub>``
reference to a submodule the module does not import itself.
"""

import ast
import importlib.util
from pathlib import Path

from django.test import SimpleTestCase

BACKEND = Path(__file__).resolve().parents[3]
SKIPPED_DIRECTORIES = {"htmlcov", "node_modules", "__pycache__"}

# Packages whose ``__init__`` does not import their submodules.
PACKAGES = ("PIL",)


def _modules() -> list[Path]:
    return [
        path
        for path in BACKEND.rglob("*.py")
        if not any(
            part in SKIPPED_DIRECTORIES or part.startswith(".")
            for part in path.relative_to(BACKEND).parts
        )
    ]


def _is_submodule(package: str, name: str) -> bool:
    try:
        return importlib.util.find_spec(f"{package}.{name}") is not None
    except ModuleNotFoundError:
        return False


def _unimported_submodules(tree: ast.Module) -> set[str]:
    """``package.Sub`` names the module uses without importing them."""
    imported: set[str] = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            imported.update(alias.name for alias in node.names)
    used: set[str] = set()
    for node in ast.walk(tree):
        if (
            isinstance(node, ast.Attribute)
            and isinstance(node.value, ast.Name)
            and node.value.id in PACKAGES
            and _is_submodule(node.value.id, node.attr)
        ):
            used.add(f"{node.value.id}.{node.attr}")
    return used - imported


class SubmoduleImportTest(SimpleTestCase):
    def test_every_used_pil_submodule_is_imported(self):
        offenders = []
        for path in _modules():
            tree = ast.parse(path.read_text(encoding="utf-8"), str(path))
            for name in sorted(_unimported_submodules(tree)):
                offenders.append(f"{path.relative_to(BACKEND).as_posix()}: uses {name}")
        self.assertEqual(
            [],
            offenders,
            "import the submodule itself (import PIL.Image, or from PIL import Image)",
        )

    def test_the_guard_finds_a_bare_package_import(self):
        tree = ast.parse("import PIL\nPIL.Image.open('x')\n")
        self.assertEqual({"PIL.Image"}, _unimported_submodules(tree))
        tree = ast.parse(
            "import PIL.Image\nPIL.Image.open('x')\nPIL.UnidentifiedImageError\n"
        )
        self.assertEqual(set(), _unimported_submodules(tree))
