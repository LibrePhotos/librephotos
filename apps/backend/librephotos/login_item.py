from __future__ import annotations

import os
import plistlib
import subprocess
from collections.abc import Sequence
from pathlib import Path

from librephotos import release_layout

LABEL = release_layout.BUNDLE_ID
LAUNCHCTL = "/bin/launchctl"
OPEN = "/usr/bin/open"
LAUNCHCTL_TIMEOUT_SECONDS = 30
START_ARGUMENTS = ("run", "--no-browser")


def agent_path(home: Path) -> Path:
    return home / "Library" / "LaunchAgents" / f"{LABEL}.plist"


def agent(app: Path, where: Sequence[str] = ()) -> dict[str, object]:
    return {
        "Label": LABEL,
        "ProgramArguments": [
            OPEN,
            "-g",
            "-a",
            str(app),
            "--args",
            *where,
            *START_ARGUMENTS,
        ],
        "RunAtLoad": True,
        "LimitLoadToSessionType": "Aqua",
        "ProcessType": "Interactive",
        "AssociatedBundleIdentifiers": [release_layout.BUNDLE_ID],
    }


def is_enabled(home: Path) -> bool:
    return agent_path(home).is_file()


def enable(app: Path, home: Path, where: Sequence[str] = ()) -> Path:
    path = agent_path(home)
    path.parent.mkdir(parents=True, exist_ok=True)
    partial = path.with_name(path.name + ".partial")
    with open(partial, "wb") as handle:
        plistlib.dump(agent(app, where), handle)
    partial.replace(path)
    return path


def disable(home: Path) -> bool:
    path = agent_path(home)
    if not path.exists():
        return False
    subprocess.run(
        [LAUNCHCTL, "bootout", f"gui/{os.getuid()}/{LABEL}"],
        capture_output=True,
        check=False,
        timeout=LAUNCHCTL_TIMEOUT_SECONDS,
    )
    path.unlink(missing_ok=True)
    return True
