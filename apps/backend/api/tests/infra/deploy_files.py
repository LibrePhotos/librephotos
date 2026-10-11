"""Readers for the deployment files the infra guards check against the code.

Guards that read ``deploy/`` or ``apps/docs/`` depend on the repository being
checked out. The backend Docker image ships ``apps/backend`` only, so callers
check ``repository_present()`` and skip when it is False.
"""

import re
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parents[3]
REPO_ROOT = BACKEND_ROOT.parent.parent
DEPLOY_DIR = REPO_ROOT / "deploy"
ENV_PAGE = (
    REPO_ROOT / "apps" / "docs" / "docs" / "installation" / "environment-variables.md"
)

_COMPOSE_INTERPOLATION = re.compile(r"\$\{([A-Za-z_][A-Za-z0-9_]*)")
# A name assigned in a .env file, commented out or not: "NAME=value" or "# NAME=value".
_ASSIGNMENT = re.compile(r"^\s*#?\s*([A-Za-z_][A-Za-z0-9_]*)=", re.MULTILINE)
# A variable the shell reads: $NAME or ${NAME...}. Lower-case names are shell
# locals in these scripts, and a bare assignment (NAME=value) is not a read.
_SHELL_READ = re.compile(r"\$\{?([A-Z][A-Z0-9_]*)")


def repository_present() -> bool:
    """True when the checkout (deploy/ and the docs page) is next to apps/backend."""
    return DEPLOY_DIR.is_dir() and ENV_PAGE.is_file()


def compose_interpolated_keys(text: str) -> set[str]:
    """Keys a compose file fills in from the .env file: ``${key}`` and ``${key:-default}``."""
    return set(_COMPOSE_INTERPOLATION.findall(text))


def env_file_keys(text: str) -> set[str]:
    """Keys defined in a .env-style file, including the ones left commented out."""
    return set(_ASSIGNMENT.findall(text))


def shell_read_names(text: str) -> set[str]:
    """Upper-case variables a shell script reads (not merely assigns).

    Whole-line comments are skipped, so a comment that mentions $HOME is not a
    read. Trailing comments are not stripped: none of the scripts put a $NAME
    after a "#" on a code line.
    """
    code = "\n".join(
        line for line in text.splitlines() if not line.lstrip().startswith("#")
    )
    return set(_SHELL_READ.findall(code))
