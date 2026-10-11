#!/usr/bin/env python3
"""Dead-code check for the backend (vulture).

Reports functions, methods, classes and properties that nothing references.
Plain ``vulture --min-confidence 60`` also lists every model field, ``Meta``
attribute and serializer field as an unused variable, which would bury the
real findings, so this runs vulture through its Python API and keeps only
those four kinds.

Tests are not scanned: code that only a test calls is dead too. Framework
entry points that nothing in the code calls by name are skipped here:

  - decorators that register the function (``@action``, ``@receiver``,
    ``@admin.register``, Flask ``@app.route`` and friends);
  - nested ``Meta`` classes and the ``Command`` class of a management command;
  - DRF ``get_<field>`` methods backing a ``SerializerMethodField`` and
    ``validate_<field>`` methods on serializers;
  - methods with a name in FRAMEWORK_METHODS (hooks Django, DRF and the
    standard library call on a subclass).

Everything else that is used but invisible to vulture (dotted paths in
settings, django_q schedules, test hooks) is listed in vulture_whitelist.py.
That file may only shrink: delete code instead of whitelisting it.

Usage (from apps/backend):
  python scripts/check_dead_code.py                  check (exit 1 on findings)
  python scripts/check_dead_code.py --make-whitelist print findings as whitelist entries
  python scripts/check_dead_code.py --root DIR       check a copy of the backend in DIR
"""

from __future__ import annotations

import argparse
import ast
import sys
from collections.abc import Iterable
from dataclasses import dataclass
from pathlib import Path

from vulture import Vulture

ROOT = Path(__file__).resolve().parent.parent
# Reported on.
PATHS = ("api", "nextcloud", "librephotos", "service", "image_similarity")
# Scanned only so that their uses count (the vendored chunked_upload calls
# hooks our views override; the entry points call into librephotos/), never
# reported on.
CONTEXT_PATHS = ("chunked_upload", "librephotos_standalone.py", "manage.py")
WHITELIST = "vulture_whitelist.py"
EXCLUDE = ("*/migrations/*", "*/tests/*", "*/test/*", "nextcloud/tests.py")
MIN_CONFIDENCE = 60
REPORTED_TYPES = frozenset({"function", "method", "class", "property"})
IGNORE_DECORATORS = (
    "@action",
    "@receiver",
    "@admin.register",
    "@app.route",
    "@app.get",
    "@app.post",
    "@app.before_request",
    "@app.teardown_request",
    "@app.errorhandler",
)
# Methods a framework calls on a subclass; a single definition is not dead.
FRAMEWORK_METHODS = frozenset(
    {
        # Django
        "ready",
        "handle",
        "add_arguments",
        "send_messages",
        # DRF views, viewsets and permissions
        "get_permissions",
        "get_serializer_class",
        "get_queryset",
        "get_object",
        "perform_create",
        "perform_update",
        "perform_destroy",
        "check_permissions",
        "has_permission",
        "has_object_permission",
        "authenticate",
        "authenticate_header",
        "list",
        "retrieve",
        "create",
        "update",
        "partial_update",
        "destroy",
        "get",
        "post",
        "put",
        "patch",
        "delete",
        # DRF serializers
        "to_representation",
        "to_internal_value",
        "validate",
        # allauth adapters
        "is_open_for_signup",
        "pre_social_login",
        "get_callback_url",
        # html.parser.HTMLParser
        "handle_data",
        "handle_starttag",
        "handle_endtag",
    }
)


@dataclass(frozen=True)
class Finding:
    path: str
    line: int
    typ: str
    name: str

    def __str__(self) -> str:
        return f"{self.path}:{self.line}: unused {self.typ} '{self.name}'"

    def whitelist_entry(self) -> str:
        # No line number: it would go stale with every edit above it.
        return f"_.{self.name}  # {self.typ} in {self.path}"


@dataclass(frozen=True)
class _Owner:
    """The class a method is defined in, as far as the skip rules need it."""

    base_names: frozenset[str]
    method_fields: frozenset[str]


def _expr_name(node: ast.expr) -> str:
    if isinstance(node, ast.Name):
        return node.id
    if isinstance(node, ast.Attribute):
        return node.attr
    if isinstance(node, ast.Call):
        return _expr_name(node.func)
    return ""


def _method_fields(cls: ast.ClassDef) -> frozenset[str]:
    """Method names a class's SerializerMethodFields call (``get_<field>`` by default)."""
    names: set[str] = set()
    for stmt in cls.body:
        if not isinstance(stmt, ast.Assign | ast.AnnAssign) or stmt.value is None:
            continue
        call = stmt.value
        if not (
            isinstance(call, ast.Call)
            and _expr_name(call.func) == "SerializerMethodField"
        ):
            continue
        # SerializerMethodField(method_name=None), by keyword or position.
        args = [
            *call.args[:1],
            *(kw.value for kw in call.keywords if kw.arg == "method_name"),
        ]
        explicit = [
            arg.value
            for arg in args
            if isinstance(arg, ast.Constant) and isinstance(arg.value, str)
        ]
        targets = stmt.targets if isinstance(stmt, ast.Assign) else [stmt.target]
        for target in targets:
            if isinstance(target, ast.Name):
                names.update(explicit or [f"get_{target.id}"])
    return frozenset(names)


def _owners(path: Path) -> dict[int, _Owner]:
    """Map each method's first line (decorators included) to its class."""
    tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
    owners: dict[int, _Owner] = {}
    for cls in ast.walk(tree):
        if not isinstance(cls, ast.ClassDef):
            continue
        owner = _Owner(
            base_names=frozenset(_expr_name(base) for base in cls.bases),
            method_fields=_method_fields(cls),
        )
        for stmt in cls.body:
            if isinstance(stmt, ast.FunctionDef | ast.AsyncFunctionDef):
                for line in [stmt.lineno, *(d.lineno for d in stmt.decorator_list)]:
                    owners[line] = owner
    return owners


def _is_framework_hook(typ: str, name: str, path: str, owner: _Owner | None) -> bool:
    if typ == "class":
        return name == "Meta" or (
            name == "Command" and "/management/commands/" in f"/{path}"
        )
    if typ != "method" or owner is None:
        return False
    if name in FRAMEWORK_METHODS or name in owner.method_fields:
        return True
    is_serializer = any(base.endswith("Serializer") for base in owner.base_names)
    return is_serializer and name.startswith("validate_")


def find_dead_code(root: Path) -> list[Finding]:
    vulture = Vulture(ignore_decorators=list(IGNORE_DECORATORS))
    scanned = [str(root / p) for p in (*PATHS, *CONTEXT_PATHS, WHITELIST)]
    # Anchored at root, so a "tests" folder above the backend excludes nothing.
    exclude = [str(root / pattern) for pattern in EXCLUDE]
    vulture.scavenge([p for p in scanned if Path(p).exists()], exclude=exclude)
    reported = tuple(root / p for p in PATHS)
    owners_by_file: dict[Path, dict[int, _Owner]] = {}
    findings: list[Finding] = []
    for item in vulture.get_unused_code(min_confidence=MIN_CONFIDENCE):
        if item.typ not in REPORTED_TYPES:
            continue
        file = Path(item.filename).resolve()
        if not any(file.is_relative_to(r.resolve()) for r in reported):
            continue
        rel = file.relative_to(root.resolve()).as_posix()
        if file not in owners_by_file:
            owners_by_file[file] = _owners(file)
        owner = owners_by_file[file].get(item.first_lineno)
        if _is_framework_hook(item.typ, item.name, rel, owner):
            continue
        findings.append(Finding(rel, item.first_lineno, item.typ, item.name))
    return sorted(findings, key=lambda f: (f.path, f.line))


def _print(lines: Iterable[str]) -> None:
    for line in lines:
        print(line)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--root", type=Path, default=ROOT, help="backend directory")
    parser.add_argument(
        "--make-whitelist",
        action="store_true",
        help="print the findings as vulture_whitelist.py entries",
    )
    args = parser.parse_args(argv)
    findings = find_dead_code(args.root)
    if args.make_whitelist:
        _print(f.whitelist_entry() for f in findings)
        return 0
    if not findings:
        print("check_dead_code: no unused functions, methods, classes or properties")
        return 0
    _print(str(f) for f in findings)
    print(
        f"\ncheck_dead_code: {len(findings)} unused definition(s). Delete them; "
        f"whitelist one in {WHITELIST} only if something outside the scanned "
        "code calls it (a dotted path in settings, a django_q schedule)."
    )
    return 1


if __name__ == "__main__":
    sys.exit(main())
