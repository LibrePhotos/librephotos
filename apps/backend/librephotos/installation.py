from __future__ import annotations

import datetime
import json
import os
import sys
from collections.abc import Collection, Sequence
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Protocol

APP_ID = "{26C84F48-38D6-462C-8222-E61176B1CF84}"
UNINSTALL_KEY = (
    "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\" + APP_ID + "_is1"
)
PROGRAM_FOLDER_NAME = "librephotos"
EXECUTABLE = "librephotos.exe"
BUILD_INFO = "build_info.json"
SETUP_NAME = "LibrePhotos-Setup-{version}.exe"
STABLE_SETUP_NAME = "LibrePhotos-Setup.exe"
SETUP_SWITCHES = ("/VERYSILENT", "/SUPPRESSMSGBOXES", "/NORESTART", "/SP-")
SKIP_RUNNING_CHECK = "/SKIPRUNNINGCHECK"
MOVE_RECORD_NAME = "program-moved.json"
DOWNLOADS_DIR_NAME = "updates"
INSTALLED = "installed"
PORTABLE = "portable"
WHERE_OPTIONS = {"--data-dir": "data_dir", "--photos": "photos"}

RegistryValue = str | int


class Registry(Protocol):
    def read(self, name: str) -> RegistryValue | None: ...

    def write(self, name: str, value: RegistryValue) -> None: ...


class UninstallEntry:
    def read(self, name: str) -> RegistryValue | None:
        if sys.platform != "win32":
            return None
        import winreg

        try:
            with winreg.OpenKey(winreg.HKEY_CURRENT_USER, UNINSTALL_KEY) as key:
                value, _ = winreg.QueryValueEx(key, name)
        except OSError:
            return None
        return value if isinstance(value, str | int) else None

    def write(self, name: str, value: RegistryValue) -> None:
        if sys.platform != "win32":
            return
        import winreg

        kind = winreg.REG_DWORD if isinstance(value, int) else winreg.REG_SZ
        with winreg.OpenKey(
            winreg.HKEY_CURRENT_USER, UNINSTALL_KEY, 0, winreg.KEY_SET_VALUE
        ) as key:
            winreg.SetValueEx(key, name, 0, kind, value)


def same_folder(first: Path | str, second: Path | str) -> bool:
    return os.path.normcase(os.path.realpath(first)) == os.path.normcase(
        os.path.realpath(second)
    )


def install_location(registry: Registry) -> Path | None:
    location = registry.read("InstallLocation")
    if not isinstance(location, str) or not location.strip():
        return None
    return Path(location.strip())


def layout(program_dir: Path, registry: Registry) -> str:
    location = install_location(registry)
    if location is not None and same_folder(program_dir.parent, location):
        return INSTALLED
    return PORTABLE


def installed_program(registry: Registry) -> Path | None:
    location = install_location(registry)
    if location is None:
        return None
    program = location / PROGRAM_FOLDER_NAME
    return program if (program / EXECUTABLE).is_file() else None


def release_version(program_dir: Path) -> str:
    try:
        info = json.loads((program_dir / BUILD_INFO).read_text(encoding="utf-8"))
    except OSError, ValueError:
        return ""
    version = info.get("version") if isinstance(info, dict) else None
    return version if isinstance(version, str) else ""


def _version_numbers(version: str) -> tuple[int, int] | None:
    parts = version.split(".")
    if len(parts) < 2 or not all(part.isdigit() for part in parts[:2]):
        return None
    return int(parts[0]), int(parts[1])


def sync_display_version(program_dir: Path, version: str, registry: Registry) -> bool:
    if not version or layout(program_dir, registry) != INSTALLED:
        return False
    if registry.read("DisplayVersion") == version:
        return False
    registry.write("DisplayVersion", version)
    numbers = _version_numbers(version)
    if numbers is not None:
        registry.write("MajorVersion", numbers[0])
        registry.write("MinorVersion", numbers[1])
    return True


@dataclass(frozen=True)
class Where:
    data_dir: str | None = None
    photos: str | None = None


def where_options(
    argv: Sequence[str], cwd: str = "", stop_at: Collection[str] = ()
) -> Where:
    found: dict[str, str] = {}
    arguments = list(argv)
    for index, argument in enumerate(arguments):
        if argument in stop_at:
            break
        name, separator, value = argument.partition("=")
        field = WHERE_OPTIONS.get(name)
        if field is None:
            continue
        if not separator:
            if index + 1 >= len(arguments):
                continue
            value = arguments[index + 1]
        found[field] = os.path.abspath(os.path.join(cwd, value)) if cwd else value
    return Where(**found)


def setup_command(setup: Path, log: Path, where: Where) -> list[str]:
    command = [str(setup), *SETUP_SWITCHES, SKIP_RUNNING_CHECK, f"/LOG={log}"]
    if where.data_dir:
        command.append(f"/DATADIR={where.data_dir}")
    if where.photos:
        command.append(f"/PHOTOS={where.photos}")
    return command


@dataclass(frozen=True)
class MoveRecord:
    moved_from: str
    moved_to: str
    version: str
    moved_at: str
    announced: bool = False

    @classmethod
    def now(cls, moved_from: Path, moved_to: Path, version: str) -> MoveRecord:
        stamp = datetime.datetime.now(datetime.UTC).isoformat(timespec="seconds")
        return cls(str(moved_from), str(moved_to), version, stamp)


def move_record_path(data_dir: Path) -> Path:
    return data_dir / MOVE_RECORD_NAME


def write_move_record(data_dir: Path, record: MoveRecord) -> None:
    move_record_path(data_dir).write_text(json.dumps(asdict(record)), encoding="utf-8")


def read_move_record(data_dir: Path) -> MoveRecord | None:
    try:
        data = json.loads(move_record_path(data_dir).read_text(encoding="utf-8"))
        return MoveRecord(**data) if isinstance(data, dict) else None
    except OSError, ValueError, TypeError:
        return None


def forward_target(
    program_dir: Path, data_dir: Path, registry: Registry
) -> Path | None:
    record = read_move_record(data_dir)
    if record is None or not same_folder(record.moved_from, program_dir):
        return None
    target = installed_program(registry)
    if target is None or same_folder(target, program_dir):
        return None
    return target / EXECUTABLE


def announce_move(program_dir: Path, data_dir: Path) -> MoveRecord | None:
    record = read_move_record(data_dir)
    if record is None or record.announced:
        return None
    if not same_folder(record.moved_to, program_dir):
        return None
    try:
        write_move_record(
            data_dir,
            MoveRecord(
                record.moved_from,
                record.moved_to,
                record.version,
                record.moved_at,
                announced=True,
            ),
        )
    except OSError:
        return None
    return record
