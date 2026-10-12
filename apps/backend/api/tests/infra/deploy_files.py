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


DOCKER_DIR = DEPLOY_DIR / "docker"
# The one entrypoint of the backend, GPU and unified images.
BACKEND_ENTRYPOINT = DOCKER_DIR / "backend" / "entrypoint.sh"

_HEREDOC = re.compile(r"<<-?\s*['\"]?([A-Za-z_][A-Za-z0-9_]*)['\"]?")


def dockerfile_instructions(text: str) -> list[tuple[str, str]]:
    """A Dockerfile as ``(KEYWORD, arguments)`` pairs.

    Continuation lines are joined, comment lines dropped (also inside a
    continuation, as Docker does) and a heredoc body (``RUN python - <<'PY'``)
    is kept with its instruction, so its lines are not read as instructions.
    """
    lines = text.splitlines()
    instructions: list[tuple[str, str]] = []
    i = 0
    while i < len(lines):
        line = lines[i]
        i += 1
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        parts = [line]
        while parts[-1].rstrip().endswith("\\") and i < len(lines):
            following = lines[i]
            i += 1
            if not following.lstrip().startswith("#"):
                parts.append(following)
        joined = " ".join(part.rstrip().removesuffix("\\").strip() for part in parts)
        for marker in _HEREDOC.findall(joined):
            body: list[str] = []
            while i < len(lines) and lines[i].strip() != marker:
                body.append(lines[i])
                i += 1
            i += 1
            joined += "\n" + "\n".join(body)
        keyword, _, arguments = joined.partition(" ")
        instructions.append((keyword.upper(), arguments.strip()))
    return instructions


def dockerfile_stages(text: str) -> list[tuple[str, str, list[tuple[str, str]]]]:
    """Each build stage as ``(image, alias, instructions after its FROM)``.

    Instructions before the first FROM (global ``ARG``s) belong to no stage.
    """
    stages: list[tuple[str, str, list[tuple[str, str]]]] = []
    for keyword, arguments in dockerfile_instructions(text):
        if keyword == "FROM":
            words = [w for w in arguments.split() if not w.startswith("--platform")]
            alias = words[2] if len(words) > 2 and words[1].lower() == "as" else ""
            stages.append((words[0], alias, []))
        elif stages:
            stages[-1][2].append((keyword, arguments))
    return stages


def image_tag(reference: str) -> str | None:
    """The tag of an image reference, or None when it has none.

    A digest (``name@sha256:...``) counts as a tag. The colon of a registry
    port (``host:5000/name``) does not.
    """
    if "@" in reference:
        return reference.split("@", 1)[1]
    name = reference.rsplit("/", 1)[-1]
    if ":" not in name:
        return None
    return name.split(":", 1)[1]
