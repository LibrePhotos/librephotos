"""Readers for the deployment files the infra guards check against the code.

Guards that read ``deploy/`` or ``apps/docs/`` depend on the repository being
checked out. The backend Docker image ships ``apps/backend`` only, so callers
check ``repository_present()`` and skip when it is False.
"""

import re
from collections.abc import Mapping
from pathlib import Path

import yaml

BACKEND_ROOT = Path(__file__).resolve().parents[3]
REPO_ROOT = BACKEND_ROOT.parent.parent
DEPLOY_DIR = REPO_ROOT / "deploy"
WORKFLOWS_DIR = REPO_ROOT / ".github" / "workflows"
COMPOSE_DIR = DEPLOY_DIR / "compose"
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


def load_compose(text: str) -> dict[str, object]:
    """A compose file as a mapping (PyYAML ships with drf-spectacular)."""
    data = yaml.safe_load(text)
    if not isinstance(data, dict):
        raise ValueError("a compose file is a YAML mapping")
    return data


def compose_service(compose: Mapping[str, object], name: str) -> dict[str, object]:
    """One service of a parsed compose file."""
    services = compose.get("services")
    if not isinstance(services, dict) or not isinstance(services.get(name), dict):
        raise KeyError(f"no service {name!r} in the compose file")
    return services[name]


def service_environment(service: Mapping[str, object]) -> dict[str, str]:
    """A service's ``environment``, list form (``- NAME=value``) or mapping form."""
    environment = service.get("environment") or {}
    if isinstance(environment, dict):
        return {str(k): "" if v is None else str(v) for k, v in environment.items()}
    if not isinstance(environment, list):
        raise ValueError("environment is a list or a mapping")
    pairs = (str(item).partition("=") for item in environment)
    return {name: value for name, _, value in pairs}


def volume_target(spec: str) -> str:
    """The container path of a short-form volume (``source:target[:mode]``).

    Colons inside ``${...}`` interpolations (``${baseLogs:-/logs}``) do not
    separate fields.
    """
    fields, depth, current = [], 0, ""
    for char in spec:
        if char == "{":
            depth += 1
        elif char == "}":
            depth -= 1
        if char == ":" and depth == 0:
            fields.append(current)
            current = ""
        else:
            current += char
    fields.append(current)
    return fields[1] if len(fields) > 1 else fields[0]
