"""One backend entrypoint, and every deploy image and pip package pinned (issue #2375).

* The backend, GPU and unified images start through one script,
  ``deploy/docker/backend/entrypoint.sh``. Image differences are guarded blocks
  in it (``nvidia-smi`` for GPU, ``SERVE_FRONTEND`` for unified) or ``ENV``
  defaults in a Dockerfile, never a second copy that drifts. Every Dockerfile
  under ``deploy/docker/`` with a ``CMD``/``ENTRYPOINT`` copies it, apart from
  the images that run no backend (``NO_BACKEND_IMAGES``). The admin account is
  only touched through ``createadmin``: no entrypoint runs ``manage.py shell``.
* An image workflow that rebuilds on a change to such a Dockerfile also
  rebuilds on a change to the entrypoint.
* Every ``image:`` of a compose file under ``deploy/`` and every ``FROM`` names a
  tag other than ``latest``, so Renovate can see and announce each bump. Our own
  images driven by ``${tag}`` or ``${BASE_TAG}`` are the exception. The k8s
  manifests use placeholders pinned in ``kustomization.yaml`` and stay out.
* ``pip install`` in a Dockerfile only installs ``-r requirements*.txt``, where
  Renovate pins the versions (the base images' ``--upgrade pip`` excepted).
* The frontend build stages of ``frontend/Dockerfile`` and ``unified/Dockerfile``
  have the same instructions.
* The start-up page (#2310) holds the backend port from before the backup and
  the migration until right before uvicorn, and the compose healthchecks and
  the e2e seed wait for ``/api/healthz/ready``: ``/api/healthz`` answers from
  the first seconds, so it no longer means "migrated and serving".

The checks read files only and skip without the repository checkout (inside the
backend image); the detectors are tested on planted text.
"""

import re
import shlex
import unittest
from fnmatch import fnmatchcase
from pathlib import Path

import yaml
from django.test import SimpleTestCase

from api.tests.infra.deploy_files import (
    BACKEND_ENTRYPOINT,
    DEPLOY_DIR,
    DOCKER_DIR,
    REPO_ROOT,
    WORKFLOWS_DIR,
    dockerfile_instructions,
    dockerfile_stages,
    image_tag,
    load_compose,
    repository_present,
)

ENTRYPOINT_SOURCE = BACKEND_ENTRYPOINT.relative_to(REPO_ROOT).as_posix()

# Dockerfiles with a CMD/ENTRYPOINT that run no backend, with the reason.
NO_BACKEND_IMAGES = {
    "deploy/docker/frontend/Dockerfile": "static file server for the web app build",
    "deploy/docker/frontend/Dockerfile.dev": "Vite dev server, with its own entrypoint",
    "deploy/docker/proxy/Dockerfile": "nginx",
}
# Entrypoint scripts under deploy/docker/: the backend one and the frontend dev one.
ENTRYPOINT_SCRIPTS = {
    ENTRYPOINT_SOURCE,
    "deploy/docker/frontend/entrypoint.sh",
}
# Image references whose tag is a variable: LibrePhotos' own images.
OWN_IMAGE = re.compile(r"^reallibrephotos/[a-z0-9-]+:\$\{[A-Za-z_]+\}$")
# Packages a Dockerfile may name directly in `pip install`, with the reason.
DIRECT_PIP_PACKAGES = {
    "deploy/docker/backend/base/Dockerfile": {"pip"},
    "deploy/docker/backend-gpu/base/Dockerfile": {"pip"},
}
FRONTEND_BUILDERS = (
    "deploy/docker/frontend/Dockerfile",
    "deploy/docker/unified/Dockerfile",
)

# The compose files whose backend has a healthcheck, and that service's name.
READINESS_CHECKED = {
    "deploy/compose/docker-compose.yml": "backend",
    "deploy/compose/docker-compose.unified.yml": "backend",
    "deploy/compose/docker-compose.e2e.yml": "e2e-backend",
}
READINESS_URL = "http://localhost:8001/api/healthz/ready"
E2E_ENTRYPOINT = "deploy/e2e/entrypoint.sh"
# /api/healthz not followed by /ready: the liveness probe.
_LIVENESS_URL = re.compile(r"/api/healthz(?!/ready)\b")

_PIP_INSTALL = re.compile(r"\bpip3?\s+install\b([^;&|\n]*)")
_REQUIREMENTS_FILE = re.compile(r"^requirements(\.[a-z]+)?\.txt$")
_WORKFLOW_DOCKERFILE = re.compile(r"deploy/docker/[\w./-]*Dockerfile[\w.-]*")


def _relative(path: Path) -> str:
    return path.relative_to(REPO_ROOT).as_posix()


def copies_backend_entrypoint(dockerfile: str) -> bool:
    return any(
        keyword == "COPY" and ENTRYPOINT_SOURCE in arguments.split()
        for keyword, arguments in dockerfile_instructions(dockerfile)
    )


def starts_something(dockerfile: str) -> bool:
    return any(
        keyword in ("CMD", "ENTRYPOINT")
        for keyword, _ in dockerfile_instructions(dockerfile)
    )


def unpinned_from_lines(dockerfile: str) -> list[str]:
    """FROM images with no tag or the ``latest`` tag (earlier stage names allowed)."""
    problems = []
    aliases: set[str] = set()
    for image, alias, _ in dockerfile_stages(dockerfile):
        if image not in aliases and not _is_pinned(image):
            problems.append(image)
        if alias:
            aliases.add(alias)
    return problems


def unpinned_compose_images(compose_text: str) -> list[str]:
    services = load_compose(compose_text).get("services") or {}
    if not isinstance(services, dict):
        raise ValueError("services is a mapping")
    return sorted(
        f"{name}: {service.get('image')}"
        for name, service in services.items()
        if isinstance(service, dict)
        and "image" in service
        and not _is_pinned(str(service["image"]))
    )


def _is_pinned(reference: str) -> bool:
    if OWN_IMAGE.match(reference):
        return True
    if "$" in reference:
        return False
    tag = image_tag(reference)
    return tag is not None and tag != "latest"


def direct_pip_packages(dockerfile: str) -> list[str]:
    """What `pip install` names other than through ``-r requirements*.txt``."""
    found = []
    for keyword, arguments in dockerfile_instructions(dockerfile):
        if keyword != "RUN":
            continue
        for match in _PIP_INSTALL.finditer(arguments):
            words = shlex.split(match.group(1))
            i = 0
            while i < len(words):
                word = words[i]
                if word in ("-r", "--requirement", "-c", "--constraint"):
                    value = words[i + 1] if i + 1 < len(words) else ""
                    if word in ("-r", "--requirement") and not _REQUIREMENTS_FILE.match(
                        value
                    ):
                        found.append(f"-r {value}")
                    i += 2
                    continue
                if not word.startswith("-"):
                    found.append(word)
                i += 1
    return found


def frontend_builder(dockerfile: str) -> tuple[str, list[tuple[str, str]]]:
    image, _, instructions = dockerfile_stages(dockerfile)[0]
    return image, instructions


def _code_lines(script: str) -> list[str]:
    stripped = (line.strip() for line in script.splitlines())
    return [line for line in stripped if line and not line.startswith("#")]


def _first(lines: list[str], pattern: str) -> int | None:
    return next((i for i, line in enumerate(lines) if re.search(pattern, line)), None)


def startup_page_problems(script: str) -> list[str]:
    """How an entrypoint breaks the start-up page's hold on the port (#2310)."""
    lines = _code_lines(script)
    serve = _first(lines, r"librephotos\.startup_page serve\b.*&$")
    stop = _first(lines, r"^stop_startup_page$")
    uvicorn = _first(lines, r"^uvicorn\b")
    if serve is None or stop is None or uvicorn is None:
        return ["starts no start-up page in the background, or never stops it"]
    problems = []
    for step in ("backup_database", "migrate", "showmigrations"):
        first = _first(lines, rf"manage\.py {step}\b")
        if first is not None and first < serve:
            problems.append(f"{step} runs before the start-up page")
    if not serve < stop < uvicorn:
        problems.append("the start-up page is not stopped right before uvicorn")
    elif any("manage.py" in line for line in lines[stop:uvicorn]):
        problems.append("a manage.py command runs between the page and uvicorn")
    return problems


def workflow_path_filters(workflow_text: str) -> list[list[str]]:
    """Every `paths:` list of a workflow's triggers."""
    data = yaml.safe_load(workflow_text)
    # PyYAML reads the bare key `on` as the boolean True.
    triggers = data.get("on", data.get(True)) or {}
    if not isinstance(triggers, dict):
        return []
    return [
        [str(p) for p in trigger["paths"]]
        for trigger in triggers.values()
        if isinstance(trigger, dict) and "paths" in trigger
    ]


def _covered(path: str, patterns: list[str]) -> bool:
    return any(fnmatchcase(path, pattern) for pattern in patterns)


def workflows_missing_entrypoint(
    workflow_text: str, entrypoint_dockerfiles: set[str]
) -> list[str]:
    """Path filters that rebuild an entrypoint image's Dockerfile but not on the entrypoint."""
    built = set(_WORKFLOW_DOCKERFILE.findall(workflow_text)) & entrypoint_dockerfiles
    problems = []
    for patterns in workflow_path_filters(workflow_text):
        for dockerfile in sorted(built):
            if _covered(dockerfile, patterns) and not _covered(
                ENTRYPOINT_SOURCE, patterns
            ):
                problems.append(
                    f"paths {patterns} cover {dockerfile} but not {ENTRYPOINT_SOURCE}"
                )
    return problems


class DeployImageDetectionTest(SimpleTestCase):
    """The detectors, on planted files."""

    def test_latest_and_untagged_images_are_unpinned(self):
        compose = (
            "services:\n"
            "  a: {image: 'foo:latest'}\n"
            "  b: {image: foo}\n"
            "  c: {image: 'foo:1.2'}\n"
            "  d: {image: 'reallibrephotos/librephotos:${tag}'}\n"
            "  e: {image: 'foo:${tag}'}\n"
            "  f: {build: {context: .}}\n"
            "  g: {image: 'registry:5000/foo'}\n"
            "  h: {image: 'foo@sha256:abc'}\n"
        )
        self.assertEqual(
            ["a: foo:latest", "b: foo", "e: foo:${tag}", "g: registry:5000/foo"],
            unpinned_compose_images(compose),
        )

    def test_from_lines(self):
        dockerfile = (
            "ARG BASE_TAG=dev\n"
            "FROM node:24-slim as builder\n"
            "FROM reallibrephotos/librephotos-base:${BASE_TAG}\n"
            "FROM builder\n"
            "FROM ubuntu\n"
            "FROM --platform=linux/amd64 nginx:latest\n"
        )
        self.assertEqual(["ubuntu", "nginx:latest"], unpinned_from_lines(dockerfile))

    def test_pip_install_must_go_through_requirements_files(self):
        dockerfile = (
            "RUN pip install --break-system-packages --no-cache-dir -r requirements.txt\n"
            'RUN if [ "$DEBUG" = 1 ] ; then \\\n'
            "  pip install --break-system-packages -r requirements.dev.txt; \\\n"
            "  fi\n"
            "RUN pip install --break-system-packages whitenoise && echo done\n"
            "RUN pip3 install -r other.txt\n"
        )
        self.assertEqual(
            ["whitenoise", "-r other.txt"], direct_pip_packages(dockerfile)
        )

    def test_heredoc_bodies_are_not_instructions(self):
        dockerfile = (
            "RUN pip install -r requirements.txt && \\\n"
            "  python - <<'PY'\n"
            "import subprocess\n"
            "CMD = 'not an instruction'\n"
            "PY\n"
            "COPY a b\n"
        )
        self.assertEqual(
            ["RUN", "COPY"],
            [keyword for keyword, _ in dockerfile_instructions(dockerfile)],
        )

    def test_a_second_entrypoint_is_seen(self):
        self.assertTrue(
            copies_backend_entrypoint(
                f'COPY {ENTRYPOINT_SOURCE} /entrypoint.sh\nCMD ["/entrypoint.sh"]\n'
            )
        )
        self.assertFalse(
            copies_backend_entrypoint(
                'COPY deploy/docker/unified/entrypoint.sh /entrypoint.sh\nCMD ["/entrypoint.sh"]\n'
            )
        )

    def test_frontend_builders_compare_instructions_not_aliases(self):
        a = "FROM node:24-slim as builder\nWORKDIR /src\nRUN yarn build\nFROM nginx:1.30\n"
        b = "FROM node:24-slim AS frontend-builder\nWORKDIR /src\nRUN yarn build\nFROM x:1\nRUN y\n"
        self.assertEqual(frontend_builder(a), frontend_builder(b))
        self.assertNotEqual(
            frontend_builder(a), frontend_builder(a.replace("/src", "/app"))
        )

    def test_the_start_up_page_must_cover_backup_and_migrate(self):
        good = (
            "python -m librephotos.startup_page serve --port 8001 &\n"
            "python manage.py showmigrations\n"
            "python manage.py backup_database\n"
            "python manage.py migrate\n"
            "python manage.py qcluster &\n"
            "# stop_startup_page\n"
            "stop_startup_page\n"
            "uvicorn app\n"
        )
        self.assertEqual([], startup_page_problems(good))
        late = "python manage.py migrate\n" + good
        self.assertEqual(
            ["migrate runs before the start-up page"], startup_page_problems(late)
        )
        gap = good.replace(
            "stop_startup_page\n", "stop_startup_page\npython manage.py clear_cache\n"
        )
        self.assertEqual(
            ["a manage.py command runs between the page and uvicorn"],
            startup_page_problems(gap),
        )
        early = good.replace("stop_startup_page\n", "").replace(
            "&\n", "&\nstop_startup_page\n", 1
        )
        self.assertEqual(1, len(startup_page_problems(early)))
        self.assertEqual(1, len(startup_page_problems("uvicorn app\n")))

    def test_workflow_paths_must_cover_the_entrypoint(self):
        workflow = (
            "on:\n  push:\n    paths:\n      - 'deploy/docker/unified/**'\n"
            "jobs: {dev: {with: {dockerfile: deploy/docker/unified/Dockerfile}}}\n"
        )
        dockerfiles = {"deploy/docker/unified/Dockerfile"}
        self.assertEqual(1, len(workflows_missing_entrypoint(workflow, dockerfiles)))
        fixed = workflow.replace(
            "      - 'deploy/docker/unified/**'\n",
            f"      - 'deploy/docker/unified/**'\n      - '{ENTRYPOINT_SOURCE}'\n",
        )
        self.assertEqual([], workflows_missing_entrypoint(fixed, dockerfiles))


@unittest.skipUnless(
    repository_present(), "needs the repository checkout (deploy/ and the docs page)"
)
class DeployImagesTest(SimpleTestCase):
    def dockerfiles(self) -> dict[str, str]:
        found = {
            _relative(path): path.read_text(encoding="utf-8")
            for path in sorted(DEPLOY_DIR.rglob("Dockerfile*"))
        }
        self.assertIn("deploy/docker/backend/Dockerfile", found)
        return found

    def test_one_backend_entrypoint(self):
        self.assertTrue(BACKEND_ENTRYPOINT.is_file())
        scripts = {_relative(p) for p in DOCKER_DIR.rglob("entrypoint*.sh")}
        self.assertEqual(ENTRYPOINT_SCRIPTS, scripts)

    def test_every_backend_image_copies_the_entrypoint(self):
        problems = [
            path
            for path, text in self.dockerfiles().items()
            if starts_something(text)
            and path not in NO_BACKEND_IMAGES
            and not copies_backend_entrypoint(text)
        ]
        self.assertEqual(
            [], problems, f"Dockerfiles that do not copy {ENTRYPOINT_SOURCE}"
        )
        self.assertEqual(
            [],
            sorted(set(NO_BACKEND_IMAGES) - set(self.dockerfiles())),
            "NO_BACKEND_IMAGES entries for Dockerfiles that are gone",
        )

    def test_the_backend_gpu_and_unified_images_use_it(self):
        dockerfiles = self.dockerfiles()
        for path in (
            "deploy/docker/backend/Dockerfile",
            "deploy/docker/backend-gpu/Dockerfile",
            "deploy/docker/unified/Dockerfile",
        ):
            with self.subTest(path=path):
                self.assertTrue(copies_backend_entrypoint(dockerfiles[path]))

    def test_no_entrypoint_runs_manage_py_shell(self):
        """The admin account is created and updated by createadmin only."""
        offenders = [
            _relative(path)
            for path in DOCKER_DIR.rglob("entrypoint*.sh")
            if re.search(r"manage\.py\s+shell", path.read_text(encoding="utf-8"))
        ]
        self.assertEqual([], offenders)

    def test_image_workflows_rebuild_on_an_entrypoint_change(self):
        entrypoint_images = {
            path
            for path, text in self.dockerfiles().items()
            if copies_backend_entrypoint(text)
        }
        problems = []
        for workflow in sorted(WORKFLOWS_DIR.glob("image-*.yml")):
            for problem in workflows_missing_entrypoint(
                workflow.read_text(encoding="utf-8"), entrypoint_images
            ):
                problems.append(f"{workflow.name}: {problem}")
        self.assertEqual([], problems)

    def test_every_from_names_a_tag(self):
        problems = [
            f"{path}: FROM {image}"
            for path, text in self.dockerfiles().items()
            for image in unpinned_from_lines(text)
        ]
        self.assertEqual([], problems)

    def test_every_compose_image_names_a_tag(self):
        files = sorted(DEPLOY_DIR.rglob("docker-compose*.yml"))
        self.assertTrue(files)
        problems = [
            f"{_relative(path)}: {problem}"
            for path in files
            for problem in unpinned_compose_images(path.read_text(encoding="utf-8"))
        ]
        self.assertEqual([], problems)

    def test_pip_installs_only_requirements_files(self):
        problems = [
            f"{path}: pip install {package}"
            for path, text in self.dockerfiles().items()
            for package in direct_pip_packages(text)
            if package not in DIRECT_PIP_PACKAGES.get(path, set())
        ]
        self.assertEqual([], problems)

    def test_the_start_up_page_holds_the_port_until_uvicorn(self):
        self.assertEqual(
            [], startup_page_problems(BACKEND_ENTRYPOINT.read_text(encoding="utf-8"))
        )

    def test_healthchecks_wait_for_readiness(self):
        for path, name in READINESS_CHECKED.items():
            with self.subTest(path=path):
                compose = load_compose((REPO_ROOT / path).read_text(encoding="utf-8"))
                service = (compose.get("services") or {})[name]
                self.assertIn(READINESS_URL, str(service["healthcheck"]["test"]))

    def test_nothing_waits_for_liveness_to_mean_ready(self):
        """The e2e files waited for /api/healthz to mean "migrated and serving"."""
        for path in (*READINESS_CHECKED, E2E_ENTRYPOINT):
            with self.subTest(path=path):
                text = (REPO_ROOT / path).read_text(encoding="utf-8")
                self.assertIsNone(_LIVENESS_URL.search(text))
        self.assertIn(
            READINESS_URL, (REPO_ROOT / E2E_ENTRYPOINT).read_text(encoding="utf-8")
        )

    def test_frontend_builder_stages_match(self):
        dockerfiles = self.dockerfiles()
        first, second = (
            frontend_builder(dockerfiles[path]) for path in FRONTEND_BUILDERS
        )
        self.assertEqual(first, second)
