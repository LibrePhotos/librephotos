#!/usr/bin/env python3
"""Type-check ratchet for the backend (mypy + django-stubs).

Runs mypy with the config in pyproject.toml and compares the result with the
checked-in baseline (mypy-baseline.txt):

  - an error that is not in the baseline fails the check (exit 1);
  - a baseline entry that no longer occurs also fails (exit 1): keys carry no
    line number, so a stale entry would let the same error come back anywhere
    in that file. Run --update and commit the smaller baseline;
  - with --base-ref, the baseline must not have grown compared with that ref,
    unless the change also touches requirements*.txt or the mypy config (a
    stub or library update may legitimately change messages);
  - a module in the strict override must have no baseline entries, and every
    pattern in it must name a module mypy checks (a renamed module left in the
    list would silently lose the strict flags);
  - mypy failing without parsable errors (crash, bad config) exits 2.

Errors are keyed as `path: [code] message`, without line numbers, so an edit
that only moves an existing error does not count as new. Keys are compared as
a multiset: a second identical error in the same file is new.

Usage (from apps/backend):
  python scripts/typecheck.py                     check against the baseline
  python scripts/typecheck.py --update            rewrite the baseline
  python scripts/typecheck.py --base-ref origin/dev
"""

from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
import tempfile
import tomllib
from collections import Counter
from dataclasses import dataclass
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BASELINE = ROOT / "mypy-baseline.txt"
PYPROJECT = ROOT / "pyproject.toml"
REPO_BASELINE = "apps/backend/mypy-baseline.txt"
HEADER = [
    "# mypy error baseline for scripts/typecheck.py.",
    "# Known errors, one per line as `path: [code] message`, sorted. CI fails on any error not listed here.",
    "# Fixed some? Shrink this file with `python scripts/typecheck.py --update`. Do not add entries by hand.",
]
# Files whose change may legitimately grow the baseline (stub/library/config updates).
DEPENDENCY_FILES = (
    "apps/backend/requirements.txt",
    "apps/backend/requirements.dev.txt",
)
LINE_NUMBER = re.compile(r"\bline \d+\b")


@dataclass(frozen=True)
class MypyError:
    key: str
    raw: str
    module_path: str


def _mypy_env() -> dict[str, str]:
    """The django-stubs plugin imports the settings, which need these to be set."""
    env = dict(os.environ)
    tmp = Path(tempfile.gettempdir()) / "librephotos-typecheck"
    env.setdefault("BASE_DATA", str(tmp))
    env.setdefault("BASE_LOGS", str(tmp / "logs"))
    env.setdefault("SECRET_KEY", "typecheck-secret-key")
    Path(env["BASE_LOGS"]).mkdir(parents=True, exist_ok=True)
    return env


def run_mypy() -> tuple[int, str, str]:
    result = subprocess.run(
        [sys.executable, "-m", "mypy", "-O", "json"],
        cwd=ROOT,
        env=_mypy_env(),
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        check=False,
    )
    return result.returncode, result.stdout, result.stderr


def _str_field(record: dict[str, object], name: str) -> str:
    value = record.get(name)
    return value if isinstance(value, str) else ""


def parse_errors(stdout: str) -> list[MypyError]:
    """Parse `mypy -O json` output. Non-JSON lines (settings noise) and notes are skipped."""
    errors: list[MypyError] = []
    for line in stdout.splitlines():
        line = line.strip()
        if not line.startswith("{"):
            continue
        try:
            record = json.loads(line)
        except json.JSONDecodeError:
            continue
        if not isinstance(record, dict) or record.get("severity") != "error":
            continue
        path = _str_field(record, "file").replace("\\", "/")
        message = _str_field(record, "message").strip()
        code = _str_field(record, "code") or "misc"
        line_no = record.get("line")
        key = f"{path}: [{code}] {LINE_NUMBER.sub('line N', message)}"
        raw = f"{path}:{line_no}: {message}  [{code}]"
        errors.append(MypyError(key=key, raw=raw, module_path=path))
    return errors


def parse_baseline(text: str) -> list[str]:
    return [
        line.rstrip()
        for line in text.splitlines()
        if line.strip() and not line.startswith("#")
    ]


def read_baseline() -> list[str]:
    if not BASELINE.exists():
        return []
    return parse_baseline(BASELINE.read_text(encoding="utf-8"))


def excess(have: Counter[str], allowed: Counter[str]) -> list[str]:
    """Keys whose count in `have` exceeds their count in `allowed`, repeated by the excess."""
    out: list[str] = []
    for key, count in have.items():
        out.extend([key] * max(0, count - allowed[key]))
    return sorted(out)


def _git(*args: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["git", *args],
        cwd=ROOT,
        capture_output=True,
        text=True,
        encoding="utf-8",
        check=False,
    )


def _mypy_config(pyproject_text: str) -> str:
    """The [tool.mypy] and [tool.django-stubs] tables, normalised for comparison."""
    tool = tomllib.loads(pyproject_text).get("tool", {})
    if not isinstance(tool, dict):
        return ""
    picked = {name: tool.get(name) for name in ("mypy", "django-stubs")}
    return json.dumps(picked, sort_keys=True)


def dependency_change_reason(base_ref: str) -> str | None:
    """Why a growing baseline is allowed against `base_ref`, or None."""
    diff = _git("diff", "--name-only", base_ref, "--", *DEPENDENCY_FILES)
    changed = [name for name in diff.stdout.splitlines() if name.strip()]
    if changed:
        return "changes " + ", ".join(changed)
    old = _git("show", f"{base_ref}:apps/backend/pyproject.toml")
    if old.returncode == 0 and _mypy_config(old.stdout) != _mypy_config(
        PYPROJECT.read_text(encoding="utf-8")
    ):
        return "changes the [tool.mypy] / [tool.django-stubs] config"
    return None


def check_growth(base_ref: str, baseline: list[str]) -> bool:
    """False when the baseline grew compared with `base_ref`."""
    old = _git("show", f"{base_ref}:{REPO_BASELINE}")
    old_keys = parse_baseline(old.stdout) if old.returncode == 0 else []
    grown = excess(Counter(baseline), Counter(old_keys))
    if not grown:
        return True
    reason = dependency_change_reason(base_ref)
    if reason is not None:
        print(
            f"\ntypecheck: the baseline grew by {len(grown)} entr(y/ies) compared with "
            f"{base_ref}. Allowed because this change {reason}; reviewers, check them:"
        )
        for key in grown:
            print(f"  {key}")
        return True
    print(
        f"\ntypecheck: the baseline grew by {len(grown)} entr(y/ies) compared with "
        f"{base_ref}. The baseline only shrinks; fix these instead:",
        file=sys.stderr,
    )
    for key in grown:
        print(f"  {key}", file=sys.stderr)
    return False


def _mypy_table() -> dict[str, object]:
    config = tomllib.loads(PYPROJECT.read_text(encoding="utf-8"))
    tool = config.get("tool", {})
    mypy = tool.get("mypy", {}) if isinstance(tool, dict) else {}
    return mypy if isinstance(mypy, dict) else {}


def _str_list(value: object) -> list[str]:
    return (
        [item for item in value if isinstance(item, str)]
        if isinstance(value, list)
        else []
    )


def strict_modules() -> list[str]:
    overrides = _mypy_table().get("overrides", [])
    modules: list[str] = []
    for override in overrides if isinstance(overrides, list) else []:
        if isinstance(override, dict) and override.get("disallow_any_explicit"):
            listed = override.get("module", [])
            modules.extend(m for m in listed if isinstance(m, str))
    return modules


def _module_of(path: str) -> str:
    name = path.removesuffix(".py").removesuffix("/__init__").replace("/", ".")
    return name.removeprefix("scripts.")


def checked_modules() -> set[str]:
    """The modules mypy checks: the .py files under ``files``, minus ``exclude``."""
    mypy = _mypy_table()
    excludes = [re.compile(pattern) for pattern in _str_list(mypy.get("exclude"))]
    modules: set[str] = set()
    for entry in _str_list(mypy.get("files")):
        path = ROOT / entry
        found = sorted(path.rglob("*.py")) if path.is_dir() else [path]
        for file in found:
            relative = file.relative_to(ROOT).as_posix()
            if file.is_file() and not any(e.search(relative) for e in excludes):
                modules.add(_module_of(relative))
    return modules


def _matches(pattern: str, module: str) -> bool:
    if pattern.endswith(".*"):
        prefix = pattern.removesuffix(".*")
        return module == prefix or module.startswith(prefix + ".")
    return module == pattern


def unmatched_strict_patterns(patterns: list[str], modules: set[str]) -> list[str]:
    """Strict-override patterns that name no module mypy checks."""
    return [p for p in patterns if not any(_matches(p, m) for m in modules)]


def strict_violations(baseline: list[str]) -> list[str]:
    patterns = strict_modules()
    out: list[str] = []
    for key in baseline:
        module = _module_of(key.split(": ", 1)[0])
        if any(_matches(pattern, module) for pattern in patterns):
            out.append(key)
    return out


def check_strict(baseline: list[str]) -> bool:
    """False when a strict module has baseline entries or a pattern names no module."""
    ok = True
    strict_hits = strict_violations(baseline)
    if strict_hits:
        ok = False
        print(
            "\nModules in the strict override must have no baseline entries:",
            file=sys.stderr,
        )
        for key in strict_hits:
            print(f"  {key}", file=sys.stderr)

    unmatched = unmatched_strict_patterns(strict_modules(), checked_modules())
    if unmatched:
        ok = False
        print(
            "\nThese strict-override patterns in pyproject.toml name no module mypy "
            "checks (renamed or deleted?); point them at the module's new name:",
            file=sys.stderr,
        )
        for pattern in unmatched:
            print(f"  {pattern}", file=sys.stderr)
    return ok


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--update", action="store_true", help="rewrite the baseline")
    parser.add_argument(
        "--base-ref", help="fail if the baseline grew compared with this git ref"
    )
    args = parser.parse_args(argv)

    status, stdout, stderr = run_mypy()
    errors = parse_errors(stdout)
    if status != 0 and not errors:
        sys.stderr.write(stdout)
        sys.stderr.write(stderr)
        print(
            f"\ntypecheck: mypy exited with status {status} but reported no parsable errors.",
            file=sys.stderr,
        )
        return 2

    current = sorted(e.key for e in errors)
    baseline = read_baseline()

    if args.update:
        BASELINE.write_text("\n".join([*HEADER, *current]) + "\n", encoding="utf-8")
        print(
            f"typecheck: wrote {len(current)} error(s) to {BASELINE.name} (was {len(baseline)})."
        )
        return 0

    print(f"typecheck: {len(current)} error(s), {len(baseline)} in baseline.")
    ok = True

    added = excess(Counter(current), Counter(baseline))
    if added:
        ok = False
        added_keys = set(added)
        print(
            f"\n{len(added)} new mypy error(s) not in the baseline:\n", file=sys.stderr
        )
        # Every occurrence of a new key is listed: when a key was in the baseline
        # N times, all N+1 occurrences are printed and one of them is new.
        for error in sorted(errors, key=lambda e: e.raw):
            if error.key in added_keys:
                print(f"  {error.raw}", file=sys.stderr)
        print(
            "\nFix them; the baseline only exists for errors that predate the check. "
            "Do not run --update to accept them.",
            file=sys.stderr,
        )

    fixed = excess(Counter(baseline), Counter(current))
    if fixed:
        ok = False
        print(
            f"\n{len(fixed)} baseline error(s) no longer occur. Nice! Run "
            "`python scripts/typecheck.py --update` and commit the smaller baseline:",
            file=sys.stderr,
        )
        for key in fixed:
            print(f"  {key}", file=sys.stderr)

    if not check_strict(baseline):
        ok = False

    if args.base_ref and not check_growth(args.base_ref, baseline):
        ok = False

    if ok:
        print("typecheck: no new errors.")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
