"""Smoke-test the Windows app's Restart to update with a built zip (#2788).

    python scripts/smoke_update.py <zip> [--work-dir DIR]

The folder swap of librephotos/updater.py in the real binary, without GitHub:
the zip is extracted twice, as the program folder ``app/librephotos`` and as
a downloaded release ``app/librephotos-next``. Then
``librephotos-next/librephotos.exe finish-update`` runs the way the old
release starts it, its old instance already gone, with relaunch arguments that
start the new one without browser or tray on a fresh data folder and free
ports. It passes when the finisher exits 0, which it only does once the new
instance answers /api/healthz/ready, and the folders traded places:
``app/librephotos`` is the one that was ``librephotos-next`` and
``app/librephotos-old`` the previous one. Whatever runs from ``app`` is ended
afterwards. On failure the logs are printed; they stay in <work dir>/data/logs.
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
import tempfile
from collections.abc import Sequence
from pathlib import Path

SCRIPTS = Path(__file__).resolve().parent
if str(SCRIPTS) not in sys.path:
    sys.path.insert(0, str(SCRIPTS))

from smoke_standalone import (  # noqa: E402
    EXECUTABLE,
    Layout,
    SmokeError,
    app_environment,
    dump_logs,
    free_ports,
    hidden_console,
    kill_all,
    processes_in,
    program_folder,
    step,
)

from api.runtime.sidecars import SERVICES  # noqa: E402

# Migrating a fresh data folder and starting every sidecar fits in this.
FINISH_TIMEOUT_SECONDS = 900.0
# Which of the two extracted copies a folder is.
SIDE_MARKER = "smoke-side.txt"
# Every name the two copies have before and after the swap.
FOLDERS = ("librephotos", "librephotos-next", "librephotos-old")


def unpack_twice(zip_path: Path, work: Path) -> tuple[Path, Path]:
    """The program folder and the downloaded release, both from ``zip_path``."""
    app = work / "app"
    app.mkdir(parents=True, exist_ok=True)
    folders = []
    for side, name in (("old", "librephotos"), ("new", "librephotos-next")):
        extracted = program_folder(zip_path, work / f"unpacked-{side}")
        target = app / name
        shutil.move(str(extracted), str(target))
        (target / SIDE_MARKER).write_text(side, encoding="utf-8")
        folders.append(target)
    return folders[0], folders[1]


def exited_pid() -> int:
    """The process ID of a process that has exited: the old instance."""
    process = subprocess.Popen([sys.executable, "-c", "pass"])
    process.wait()
    return process.pid


def finish_command(current: Path, staged: Path, layout: Layout, port: int) -> list[str]:
    relaunch = [
        "--data-dir",
        str(layout.data),
        "--photos",
        str(layout.photos),
        "run",
        "--no-browser",
        "--no-tray",
        "--port",
        str(port),
    ]
    return [
        str(staged / EXECUTABLE),
        "finish-update",
        "--old-pid",
        str(exited_pid()),
        "--old-dir",
        str(current),
        "--url",
        f"http://127.0.0.1:{port}/",
        "--log",
        str(layout.logs / "update.log"),
        "--cwd",
        str(layout.work),
        "--relaunch",
        json.dumps(relaunch),
    ]


def side(folder: Path) -> str:
    try:
        return (folder / SIDE_MARKER).read_text(encoding="utf-8")
    except OSError:
        return ""


def check_swap(app: Path) -> None:
    current, rollback = app / "librephotos", app / "librephotos-old"
    if (
        side(current) != "new"
        or side(rollback) != "old"
        or (app / "librephotos-next").exists()
    ):
        found = sorted(path.name for path in app.iterdir())
        raise SmokeError(f"the program folders did not trade places: {found}")


def run(zip_path: Path, layout: Layout) -> None:
    current, staged = unpack_twice(zip_path, layout.work)
    web_port, *sidecar_ports = free_ports(1 + len(SERVICES))
    ports = dict(zip(SERVICES, sidecar_ports, strict=True))
    command = finish_command(current, staged, layout, web_port)
    step(f"{staged / EXECUTABLE} finish-update, the new release on port {web_port}")
    with open(layout.logs / "smoke-finish.log", "w", encoding="utf-8") as log:
        completed = subprocess.run(
            command,
            env=app_environment(os.environ, ports),
            stdout=log,
            stderr=subprocess.STDOUT,
            stdin=subprocess.DEVNULL,
            timeout=FINISH_TIMEOUT_SECONDS,
            check=False,
            **hidden_console(),
        )
    if completed.returncode != 0:
        raise SmokeError(f"finish-update exited with {completed.returncode}")
    check_swap(current.parent)


def parse_args(argv: Sequence[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("zip", type=Path, help="the release zip")
    parser.add_argument(
        "--work-dir",
        type=Path,
        help="where the folders and the data go (default: a new temporary folder)",
    )
    return parser.parse_args(argv)


def main(argv: Sequence[str] | None = None) -> int:
    args = parse_args(sys.argv[1:] if argv is None else argv)
    work = args.work_dir or Path(tempfile.mkdtemp(prefix="librephotos-update-"))
    layout = Layout(work.resolve())
    layout.create()
    try:
        run(args.zip.resolve(), layout)
    except (SmokeError, OSError, subprocess.SubprocessError) as error:
        dump_logs(layout.logs)
        print(f"update smoke: FAILED: {error}", file=sys.stderr, flush=True)
        return 1
    finally:
        # The new instance and anything else still running from the folders.
        for name in FOLDERS:
            kill_all(processes_in(layout.work / "app" / name))
    print(f"update smoke: passed (logs in {layout.logs})", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
