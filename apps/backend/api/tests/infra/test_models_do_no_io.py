"""Models hold data and queries; disk, sidecar and ffmpeg work lives in services.

A model module defines fields, managers and querysets, properties computed
from fields and pure helpers. Anything that touches the filesystem, a
subprocess, a sidecar or the network goes in a service module of the owning
domain that takes the model instance as its first argument
(``api.thumbnails.render.generate_thumbnail``, ``api.photos.files.remove_photo``,
``api.metadata.photo_writer.write_photo_metadata``). A side effect hidden in
a model method or in ``save()`` is how a rescan came to rewrite ratings
(#2295) and a date edit was written twice (#2298); see #2336.

This walks every module under ``api/models/`` (imports inside functions
included) and fails on an import of an I/O module or a call that writes or
reads files directly. There is no baseline: every model method that did I/O
has moved out.
"""

import ast
from pathlib import Path

from django.test import SimpleTestCase

BACKEND = Path(__file__).resolve().parents[3]
MODELS = BACKEND / "api" / "models"

# Modules a model must not import, with everything below them.
FORBIDDEN_MODULES = (
    "api.runtime.sidecars",
    "api.classification.captioning",
    "api.faces.recognition",
    "api.thumbnails",
    "api.metadata.photo_writer",
    "api.metadata.writer",
    "api.metadata.reader",
    "api.photos",
    "subprocess",
    "requests",
    "exiftool",
    "pyvips",
    "PIL",
)

# Calls that read or change files: ``open(...)``, ``os.remove(...)``, ...
FORBIDDEN_CALLS = frozenset(
    {"open", "os.remove", "os.unlink", "os.replace", "os.rename", "os.makedirs"}
)
# Any call on these modules: ``shutil.rmtree(...)``, ``shutil.copy(...)``.
FORBIDDEN_CALL_MODULES = ("shutil",)


def _is_forbidden(module: str) -> bool:
    return any(
        module == forbidden or module.startswith(forbidden + ".")
        for forbidden in FORBIDDEN_MODULES
    )


def _dotted(node: ast.expr) -> str | None:
    if isinstance(node, ast.Name):
        return node.id
    if isinstance(node, ast.Attribute):
        base = _dotted(node.value)
        return None if base is None else f"{base}.{node.attr}"
    return None


def _imported_modules(node: ast.AST) -> list[str]:
    """Every module an import statement brings in, ``from a import b`` as both
    ``a`` and ``a.b`` (``b`` may be a module: ``from api.runtime import sidecars``)."""
    if isinstance(node, ast.Import):
        return [alias.name for alias in node.names]
    if isinstance(node, ast.ImportFrom) and node.module and not node.level:
        return [node.module] + [f"{node.module}.{a.name}" for a in node.names]
    return []


def io_findings(source: str) -> list[str]:
    """The forbidden imports and calls in a model module's ``source``."""
    findings: list[tuple[int, str]] = []
    for node in ast.walk(ast.parse(source)):
        for module in _imported_modules(node):
            if _is_forbidden(module):
                findings.append((node.lineno, f"imports {module}"))
        if isinstance(node, ast.Call):
            name = _dotted(node.func)
            if name is None:
                continue
            if name in FORBIDDEN_CALLS or name.split(".")[0] in FORBIDDEN_CALL_MODULES:
                findings.append((node.lineno, f"calls {name}()"))
            # LazyModule("pyvips") is an import by another name.
            if (
                name.split(".")[-1] == "LazyModule"
                and node.args
                and isinstance(node.args[0], ast.Constant)
                and isinstance(node.args[0].value, str)
                and _is_forbidden(node.args[0].value)
            ):
                findings.append((node.lineno, f"lazily imports {node.args[0].value}"))
    return [f"line {line}: {what}" for line, what in sorted(findings)]


class ModelsDoNoIOTest(SimpleTestCase):
    def test_no_model_module_does_io(self):
        findings = {
            str(path.relative_to(BACKEND)).replace("\\", "/"): found
            for path in sorted(MODELS.glob("*.py"))
            if (found := io_findings(path.read_text(encoding="utf-8")))
        }
        self.assertEqual(
            {},
            findings,
            "A model module does I/O. Move it to a service module of the "
            "owning domain that takes the instance as its first argument "
            "(apps/backend/AGENTS.md, #2336).",
        )


class CheckerTest(SimpleTestCase):
    """The checker itself: it catches what the rule forbids."""

    def test_a_planted_sidecar_import_in_tag_fails(self):
        source = (MODELS / "tag.py").read_text(encoding="utf-8")
        planted = source + "\nfrom api.runtime import sidecars\n"
        self.assertEqual([], io_findings(source))
        self.assertEqual(
            [f"line {planted.count(chr(10))}: imports api.runtime.sidecars"],
            io_findings(planted),
        )

    def test_imports_inside_functions_count(self):
        source = "def f():\n    import subprocess\n    from PIL import Image\n"
        self.assertEqual(
            [
                "line 2: imports subprocess",
                "line 3: imports PIL",
                "line 3: imports PIL.Image",
            ],
            io_findings(source),
        )

    def test_submodules_of_forbidden_modules_count(self):
        self.assertEqual(
            ["line 1: imports api.metadata.writer"],
            io_findings("import api.metadata.writer\n"),
        )
        self.assertEqual(
            ["line 1: imports api.metadata.reader"],
            io_findings("from api.metadata.reader import get_metadata\n")[:1],
        )

    def test_pure_modules_pass(self):
        source = (
            "import os\n"
            "from api.metadata.tags import Tags\n"
            "from api.mime import extension\n"
            "x = os.path.join('a', 'b')\n"
        )
        self.assertEqual([], io_findings(source))

    def test_file_calls_fail(self):
        source = "import os, shutil\nopen('x')\nos.remove('x')\nshutil.rmtree('d')\n"
        self.assertEqual(
            [
                "line 2: calls open()",
                "line 3: calls os.remove()",
                "line 4: calls shutil.rmtree()",
            ],
            io_findings(source),
        )

    def test_a_lazy_import_counts(self):
        self.assertEqual(
            ["line 1: lazily imports pyvips"],
            io_findings('pyvips = LazyModule("pyvips")\n'),
        )
