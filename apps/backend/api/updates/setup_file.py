from __future__ import annotations

from pathlib import Path

import requests

from librephotos.installation import SETUP_NAME

from .download import GITHUB, ReleaseSource, Target, download_asset, sha256_file
from .stage import (
    SILENT,
    VERIFYING,
    Reporter,
    check_free_space,
    expected_sha256,
    verify_download,
)

MAX_SETUP_BYTES = 2 * 2**30
REQUIRED_FREE_BYTES = 3 * 2**30


def setup_name(version: str) -> str:
    return SETUP_NAME.format(version=version)


def stage_setup(
    session: requests.Session,
    folder: Path,
    version: str,
    reporter: Reporter = SILENT,
    source: ReleaseSource = GITHUB,
) -> Path:
    name = setup_name(version)
    url = source.asset_url(version, name)
    folder.mkdir(parents=True, exist_ok=True)
    check_free_space(folder, REQUIRED_FREE_BYTES)
    expected = expected_sha256(session, source, version, name)
    target = folder / name
    if target.is_file() and sha256_file(target) == expected:
        return target
    part = folder / f"{name}.part"
    download_asset(
        session, source, url, Target(part, MAX_SETUP_BYTES, reporter.progress)
    )
    reporter.phase(VERIFYING)
    verify_download(part, expected)
    part.replace(target)
    return target
