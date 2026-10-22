#!/usr/bin/env python3
"""The import contracts' baseline only shrinks.

Each contract under [tool.importlinter] in pyproject.toml lists the violations
that predate it in `ignore_imports`. `lint-imports` already fails on an entry
that no longer matches an import (a fixed violation still listed). This fails
on the other direction: an entry that the same contract at the base ref did not
list, which would accept a new violation instead of fixing it.

A contract that is new, or whose definition (anything but ignore_imports)
changed, may add entries: a new contract starts with today's violations, and a
move PR that adds its package to a layer may uncover some. They are printed for
review instead of failing.

A moved module keeps its entries: a module renamed since the base ref (git's
rename detection, as in scripts/ruff_baseline.py) is compared under its old
name, so "api.models.user -> api.date_time_extractor" at the base ref covers
"api.models.user -> api.metadata.datetime_rules" after the move.

Usage (from apps/backend):
  python scripts/import_contracts_baseline.py --base-ref origin/dev
"""

from __future__ import annotations

import argparse
import sys
import tomllib
from pathlib import Path

from ruff_baseline import REPO_PREFIX, _git, renamed_paths

PYPROJECT = Path(__file__).resolve().parent.parent / "pyproject.toml"

# Contract id -> its ignore_imports entries, each normalized to "a -> b".
Ignores = dict[str, set[str]]
# Contract id -> its definition without ignore_imports, for comparison.
Definitions = dict[str, str]


def module_name(path: str) -> str | None:
    """The dotted module of a backend-relative ``.py`` path, else None."""
    if not path.endswith(".py"):
        return None
    parts = path.removesuffix(".py").split("/")
    if parts[-1] == "__init__":
        parts.pop()
    return ".".join(parts)


def renamed_modules(renames: dict[str, str]) -> dict[str, str]:
    """New module -> old module, from new path -> old path."""
    modules: dict[str, str] = {}
    for new_path, old_path in renames.items():
        new, old = module_name(new_path), module_name(old_path)
        if new and old:
            modules[new] = old
    return modules


def old_module(module: str, renames: dict[str, str]) -> str:
    """The name `module` had at the base ref (a renamed package renames its children)."""
    for new, old in renames.items():
        if module == new:
            return old
        if module.startswith(new + "."):
            return old + module[len(new) :]
    return module


def _normalize(entry: str) -> str:
    importer, _, imported = entry.partition("->")
    return f"{importer.strip()} -> {imported.strip()}"


def parse_contracts(pyproject_text: str) -> tuple[Ignores, Definitions]:
    config = tomllib.loads(pyproject_text)
    importlinter = config.get("tool", {}).get("importlinter", {})
    ignores: Ignores = {}
    definitions: Definitions = {}
    for contract in importlinter.get("contracts", []):
        key = str(contract.get("id") or contract.get("name"))
        ignores[key] = {_normalize(str(e)) for e in contract.get("ignore_imports", [])}
        rest = {k: v for k, v in contract.items() if k != "ignore_imports"}
        top = {k: v for k, v in importlinter.items() if k != "contracts"}
        definitions[key] = repr(sorted({**rest, "__top__": top}.items()))
    return ignores, definitions


def grown_entries(
    current: Ignores, old: Ignores, renames: dict[str, str]
) -> list[tuple[str, str]]:
    """(contract, entry) pairs in `current` that `old` did not list."""
    grown = []
    for contract, entries in sorted(current.items()):
        for entry in sorted(entries):
            importer, _, imported = entry.partition(" -> ")
            before = (
                f"{old_module(importer, renames)} -> {old_module(imported, renames)}"
            )
            if before not in old.get(contract, set()):
                grown.append((contract, entry))
    return grown


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument(
        "--base-ref",
        required=True,
        help="fail if a contract gained ignore_imports entries compared with this git ref",
    )
    args = parser.parse_args(argv)

    old = _git("show", f"{args.base_ref}:{REPO_PREFIX}pyproject.toml")
    if old.returncode != 0:
        print(f"import_contracts_baseline: {args.base_ref} has no pyproject.toml.")
        return 0
    current, current_definitions = parse_contracts(
        PYPROJECT.read_text(encoding="utf-8")
    )
    old_ignores, old_definitions = parse_contracts(old.stdout)
    grown = grown_entries(
        current, old_ignores, renamed_modules(renamed_paths(args.base_ref))
    )
    changed = {
        contract
        for contract, definition in current_definitions.items()
        if old_definitions.get(contract) != definition
    }
    allowed = [(contract, entry) for contract, entry in grown if contract in changed]
    grown = [(contract, entry) for contract, entry in grown if contract not in changed]
    if allowed:
        print(
            f"import_contracts_baseline: {len(allowed)} ignore_imports entr(y/ies) "
            "added to contracts that are new or changed; reviewers, check them:"
        )
        for contract, entry in allowed:
            print(f"  [{contract}] {entry}")
    if not grown:
        print("import_contracts_baseline: no new ignore_imports entries.")
        return 0
    print(
        f"import_contracts_baseline: {len(grown)} ignore_imports entr(y/ies) added "
        f"compared with {args.base_ref}. The baseline only shrinks; fix the import:",
        file=sys.stderr,
    )
    for contract, entry in grown:
        print(f"  [{contract}] {entry}", file=sys.stderr)
    return 1


if __name__ == "__main__":
    sys.exit(main())
