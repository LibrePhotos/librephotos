from __future__ import annotations

import glob
import os
import shlex
import subprocess
from collections.abc import Iterable
from pathlib import Path

SIGN_ARGS_ENV = "WINDOWS_SIGN_ARGS"
SIGNTOOL_ENV = "WINDOWS_SIGNTOOL"
PE_SUFFIXES = frozenset({".exe", ".dll", ".pyd", ".sys", ".ocx"})
BATCH = 50
SDK_PATTERN = r"C:\Program Files (x86)\Windows Kits\10\bin\*\x64\signtool.exe"


def _unquoted(token: str) -> str:
    if len(token) >= 2 and token[0] == token[-1] == '"':
        return token[1:-1]
    return token


def sign_arguments() -> list[str]:
    raw = os.environ.get(SIGN_ARGS_ENV, "").strip()
    return [_unquoted(token) for token in shlex.split(raw, posix=False)]


def signtool() -> str:
    explicit = os.environ.get(SIGNTOOL_ENV)
    if explicit:
        return explicit
    found = sorted(glob.glob(SDK_PATTERN))
    if not found:
        raise SystemExit(f"{SIGN_ARGS_ENV} is set, but no signtool.exe was found")
    return found[-1]


def pe_files(folder: Path) -> list[Path]:
    return sorted(
        path
        for path in Path(folder).rglob("*")
        if path.is_file() and path.suffix.lower() in PE_SUFFIXES
    )


def sign(paths: Iterable[Path], arguments: list[str], tool: str | None = None) -> int:
    tool = tool or signtool()
    names = [str(path) for path in paths]
    for start in range(0, len(names), BATCH):
        subprocess.run([tool, *arguments, *names[start : start + BATCH]], check=True)
    return len(names)


def sign_folder(folder: Path) -> int:
    arguments = sign_arguments()
    if not arguments:
        print(f"signing: skipped ({SIGN_ARGS_ENV} is not set)", flush=True)
        return 0
    count = sign(pe_files(folder), arguments)
    print(f"signing: signed {count} files in {folder}", flush=True)
    return count


def inno_sign_tool() -> str | None:
    arguments = sign_arguments()
    if not arguments:
        return None
    return subprocess.list2cmdline([signtool(), *arguments]) + " $f"
