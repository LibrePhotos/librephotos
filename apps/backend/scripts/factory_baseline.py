"""Raw model creates in backend tests, counted against a baseline that only shrinks.

api/tests/utils.py has a factory for each model in FACTORIES. A test module
that builds one of those rows with ``Model.objects.create(...)`` (or
create_user, create_superuser, get_or_create, bulk_create) is counted here.
api/tests/infra/test_data_baseline.txt lists the count per file. The guard test
api/tests/infra/test_test_data_factories.py fails when a file is not listed
with its count, and when a listed count no longer matches the tree.

    python scripts/factory_baseline.py            check the tree against the baseline
    python scripts/factory_baseline.py --update   rewrite the baseline (it may only shrink)

A raw create that is meant to stay raw (a constraint test, a migration) carries
a ``# raw-create: <reason>`` comment on any line of its call and is not counted.
"""

from __future__ import annotations

import ast
import os
import sys
from collections.abc import Iterator, Mapping
from dataclasses import dataclass
from pathlib import Path

BACKEND = Path(__file__).resolve().parent.parent
BASELINE = BACKEND / "api" / "tests" / "infra" / "test_data_baseline.txt"
UTILS = "api/tests/utils.py"
RAW_CREATE_MARK = "# raw-create:"
CREATE_METHODS = frozenset(
    {"create", "create_user", "create_superuser", "get_or_create", "bulk_create"}
)
# Model -> the factory in api/tests/utils.py that builds it.
FACTORIES = {
    "User": "create_test_user",
    "Photo": "create_test_photo",
    "File": "create_test_file",
    "Face": "create_test_face",
    "Person": "create_test_person",
    "AlbumUser": "create_test_album_user",
    "AlbumDate": "create_test_album_date",
    "Tag": "create_test_tag",
    "PhotoStack": "create_test_stack",
    "Duplicate": "create_test_duplicate",
    "LongRunningJob": "create_test_job",
    "Cluster": "create_test_cluster",
}
HEADER = (
    "# do not edit by hand: regenerate with `python scripts/factory_baseline.py --update`.",
    "# Raw `<Model>.objects.create(...)` calls in backend test modules, per file, for the models that",
    "# have a factory in api/tests/utils.py (FACTORIES in scripts/factory_baseline.py). Sorted by path.",
    "# It only shrinks: move a file to its factories, then regenerate. A raw create that must stay raw",
    "# carries `# raw-create: <reason>` on its line and is not listed here.",
)


@dataclass(frozen=True)
class RawCreate:
    path: str
    line: int
    model: str
    method: str
    accepted: bool

    def describe(self) -> str:
        return (
            f"{self.path}:{self.line}: {self.model}.objects.{self.method}(...) "
            f"-- use {FACTORIES[self.model]}() from api.tests.utils"
        )


def iter_test_modules(backend: Path = BACKEND) -> Iterator[Path]:
    """Test modules under the backend: test_*.py files and anything in a tests/ directory."""
    for dirpath, dirnames, filenames in os.walk(backend):
        dirnames[:] = [d for d in dirnames if not d.startswith((".", "__pycache__"))]
        for filename in sorted(filenames):
            if not filename.endswith(".py"):
                continue
            path = Path(dirpath) / filename
            rel = path.relative_to(backend)
            if rel.as_posix() == UTILS:
                continue
            if filename.startswith("test_") or "tests" in rel.parts[:-1]:
                yield path


def find_raw_creates(source: str, path: str) -> list[RawCreate]:
    """Every call on a covered model's ``objects`` manager, with its line numbers."""
    lines = source.splitlines()
    hits: list[RawCreate] = []
    for node in ast.walk(ast.parse(source, filename=path)):
        if not isinstance(node, ast.Call) or not isinstance(node.func, ast.Attribute):
            continue
        if node.func.attr not in CREATE_METHODS:
            continue
        manager = node.func.value
        if not (
            isinstance(manager, ast.Attribute)
            and manager.attr == "objects"
            and isinstance(manager.value, ast.Name)
            and manager.value.id in FACTORIES
        ):
            continue
        span = lines[node.lineno - 1 : node.end_lineno]
        accepted = any(RAW_CREATE_MARK in line for line in span)
        hits.append(
            RawCreate(path, node.lineno, manager.value.id, node.func.attr, accepted)
        )
    return sorted(hits, key=lambda hit: hit.line)


def collect(backend: Path = BACKEND) -> list[RawCreate]:
    hits: list[RawCreate] = []
    for path in iter_test_modules(backend):
        rel = path.relative_to(backend).as_posix()
        source = path.read_text(encoding="utf-8")
        hits.extend(find_raw_creates(source, rel))
    return hits


def count_by_file(hits: list[RawCreate]) -> dict[str, int]:
    counts: dict[str, int] = {}
    for hit in hits:
        if not hit.accepted:
            counts[hit.path] = counts.get(hit.path, 0) + 1
    return counts


def read_baseline(path: Path = BASELINE) -> dict[str, int]:
    counts: dict[str, int] = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        if not line.strip() or line.startswith("#"):
            continue
        file, _, count = line.rpartition(" ")
        counts[file] = int(count)
    return counts


def render_baseline(counts: Mapping[str, int]) -> str:
    lines = list(HEADER)
    lines.extend(f"{path} {count}" for path, count in sorted(counts.items()) if count)
    return "\n".join(lines) + "\n"


def problems(actual: Mapping[str, int], baseline: Mapping[str, int]) -> list[str]:
    """Why ``actual`` does not match ``baseline``; empty when it does."""
    out: list[str] = []
    for path in sorted(set(actual) | set(baseline)):
        have = actual.get(path, 0)
        listed = baseline.get(path, 0)
        if have > listed:
            out.append(f"{path}: {have} raw creates, baseline allows {listed}")
        elif have < listed:
            out.append(
                f"{path}: baseline lists {listed} but the file has {have}; "
                "regenerate the baseline"
            )
    return out


def main(argv: list[str]) -> int:
    hits = collect()
    counts = count_by_file(hits)
    if "--update" in argv:
        # The first write has no baseline to grow from; afterwards it may only shrink.
        listed = read_baseline() if BASELINE.exists() else None
        grown = sorted(
            path
            for path, count in counts.items()
            if listed is not None and count > listed.get(path, 0)
        )
        if grown:
            print("factory_baseline: refusing to grow the baseline:", file=sys.stderr)
            for path in grown:
                print(f"  {path}: {counts[path]} raw creates", file=sys.stderr)
            return 1
        BASELINE.write_text(render_baseline(counts), encoding="utf-8", newline="\n")
        print(
            f"factory_baseline: wrote {sum(counts.values())} raw creates "
            f"in {len(counts)} files"
        )
        return 0
    found = problems(counts, read_baseline())
    if not found:
        print(
            f"factory_baseline: {sum(counts.values())} raw creates, matches the baseline"
        )
        return 0
    for line in found:
        print(line)
    return 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
