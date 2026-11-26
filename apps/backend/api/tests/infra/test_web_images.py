import re
import shlex
import tomllib
import unittest
from datetime import date, datetime, timedelta

import yaml
from django.test import SimpleTestCase

from api.tests.infra.deploy_files import (
    COMPOSE_DIR,
    DOCKER_DIR,
    REPO_ROOT,
    WORKFLOWS_DIR,
    compose_service,
    dockerfile_stages,
    load_compose,
    repository_present,
)

FRONTEND_DOCKERFILE = DOCKER_DIR / "frontend" / "Dockerfile"
PROXY_DOCKERFILE = DOCKER_DIR / "proxy" / "Dockerfile"
E2E_COMPOSE = COMPOSE_DIR / "docker-compose.e2e.yml"
SCAN_IMAGES = WORKFLOWS_DIR / "scan-images.yml"
SCAN_DEPENDENCIES = WORKFLOWS_DIR / "scan-dependencies.yml"
OSV_CONFIG = REPO_ROOT / "osv-scanner.toml"
TRIVY_IGNORE = REPO_ROOT / ".trivyignore.yaml"

SERVER_MODULE = "github.com/halverneus/static-file-server/bin/serve"
SERVER_VERSION_ARG = "STATIC_FILE_SERVER_VERSION"
LONGEST_IGNORE = timedelta(days=183)
SCANNER_PINS = {
    SCAN_IMAGES: ("TRIVY_VERSION", "TRIVY_SHA256"),
    SCAN_DEPENDENCIES: ("OSV_SCANNER_VERSION", "OSV_SCANNER_SHA256"),
}

_EVEN_MINOR_ALPINE_SLIM = re.compile(r"^nginx:\d+\.\d*[02468]-alpine-slim$")
_RELEASE = re.compile(r"^v\d+\.\d+\.\d+$")
_SEMVER = re.compile(r"^\d+\.\d+\.\d+$")
_SHA256 = re.compile(r"^[0-9a-f]{64}$")


def _arguments(instructions: list[tuple[str, str]], keyword: str) -> list[str]:
    return [arguments for found, arguments in instructions if found == keyword]


def _global_args(text: str) -> dict[str, str]:
    stages = dockerfile_stages(text)
    pairs = (
        word.partition("=")
        for _, _, instructions in stages
        for arguments in _arguments(instructions, "ARG")
        for word in shlex.split(arguments)
    )
    return {key: value for key, _, value in pairs}


def frontend_image_problems(text: str) -> list[str]:
    stages = dockerfile_stages(text)
    problems = []
    if any(image.startswith("halverneus/") for image, _, _ in stages):
        problems.append("uses the prebuilt static-file-server image")
    version = _global_args(text).get(SERVER_VERSION_ARG, "")
    if not _RELEASE.match(version):
        problems.append(f"{SERVER_VERSION_ARG} is not a release tag: {version!r}")
    installs = [
        arguments
        for _, _, instructions in stages
        for arguments in _arguments(instructions, "RUN")
        if f"{SERVER_MODULE}@${{{SERVER_VERSION_ARG}}}" in arguments
    ]
    if not installs or not all("CGO_ENABLED=0" in run for run in installs):
        problems.append(f"no static CGO_ENABLED=0 build of {SERVER_MODULE}")
    image, _, final = stages[-1]
    if image != "scratch":
        problems.append(f"the final stage builds FROM {image}, not scratch")
    expected = {
        "ENTRYPOINT": '["/serve"]',
        "USER": "static",
        "ENV": "PORT=3000",
    }
    for keyword, value in expected.items():
        if value not in _arguments(final, keyword):
            problems.append(f"the final stage has no {keyword} {value}")
    if not any(a.endswith("/dist /web") for a in _arguments(final, "COPY")):
        problems.append("the final stage does not copy the build to /web")
    return problems


def proxy_image_problems(text: str) -> list[str]:
    stages = dockerfile_stages(text)
    problems = []
    if len(stages) != 1 or not _EVEN_MINOR_ALPINE_SLIM.match(stages[0][0]):
        problems.append("not one stage FROM nginx:<stable>-alpine-slim")
    runs = [a for _, _, instructions in stages for a in _arguments(instructions, "RUN")]
    if "apk upgrade --no-cache" not in runs:
        problems.append("does not take the Alpine fixes released after the base image")
    return problems


def _as_date(value: object) -> date | None:
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    return None


def ignore_problems(
    entries: list[dict[str, object]], until_key: str, reason_key: str, today: date
) -> list[str]:
    problems = []
    for entry in entries:
        name = entry.get("id", "an entry without an id")
        until = _as_date(entry.get(until_key))
        if until is None:
            problems.append(f"{name}: no {until_key}")
        elif until - today > LONGEST_IGNORE:
            problems.append(f"{name}: {until_key} {until} is more than 6 months away")
        if not str(entry.get(reason_key) or "").strip():
            problems.append(f"{name}: no {reason_key}")
    return problems


def workflow_env(text: str) -> dict[str, str]:
    data = yaml.safe_load(text) or {}
    return {str(k): str(v) for k, v in (data.get("env") or {}).items()}


class WebImageDetectionTest(SimpleTestCase):
    frontend = (
        "FROM node:24-slim as builder\n"
        "RUN yarn run build\n"
        "FROM golang:1.27-alpine AS static-file-server\n"
        "ARG STATIC_FILE_SERVER_VERSION=v1.8.12\n"
        "RUN CGO_ENABLED=0 go install \\\n"
        f'      "{SERVER_MODULE}@${{STATIC_FILE_SERVER_VERSION}}"\n'
        "FROM scratch\n"
        "COPY --from=static-file-server /out/serve /serve\n"
        "USER static\n"
        "ENV PORT=3000\n"
        "COPY --from=builder /usr/src/app/apps/frontend/dist /web\n"
        'ENTRYPOINT ["/serve"]\n'
    )

    def test_a_source_build_on_scratch_passes(self):
        self.assertEqual([], frontend_image_problems(self.frontend))

    def test_the_prebuilt_server_image_and_a_floating_version_fail(self):
        prebuilt = self.frontend.replace(
            "FROM scratch\n", "FROM halverneus/static-file-server:v1.8.12\n"
        )
        self.assertEqual(2, len(frontend_image_problems(prebuilt)))
        floating = self.frontend.replace("=v1.8.12", "=latest")
        self.assertEqual(1, len(frontend_image_problems(floating)))
        cgo = self.frontend.replace("CGO_ENABLED=0 ", "")
        self.assertEqual(1, len(frontend_image_problems(cgo)))

    def test_the_proxy_needs_alpine_slim_on_a_stable_minor_and_apk_upgrade(self):
        good = "FROM nginx:1.30-alpine-slim\nRUN apk upgrade --no-cache\nCOPY a b\n"
        self.assertEqual([], proxy_image_problems(good))
        self.assertEqual(
            1,
            len(
                proxy_image_problems(
                    good.replace("1.30-alpine-slim", "1.31-alpine-slim")
                )
            ),
        )
        self.assertEqual(
            1, len(proxy_image_problems(good.replace("1.30-alpine-slim", "1.30")))
        )
        self.assertEqual(
            1,
            len(proxy_image_problems(good.replace("RUN apk upgrade --no-cache\n", ""))),
        )

    def test_an_ignore_needs_a_near_expiry_and_a_reason(self):
        today = date(2026, 11, 26)
        entries = [
            {
                "id": "A",
                "effectiveUntil": datetime(2027, 3, 1),
                "reason": "upstream #1",
            },
            {"id": "B", "reason": "upstream #2"},
            {"id": "C", "effectiveUntil": datetime(2028, 1, 1), "reason": "x"},
            {"id": "D", "effectiveUntil": datetime(2027, 1, 1), "reason": " "},
        ]
        self.assertEqual(
            [
                "B: no effectiveUntil",
                "C: effectiveUntil 2028-01-01 is more than 6 months away",
                "D: no reason",
            ],
            ignore_problems(entries, "effectiveUntil", "reason", today),
        )


@unittest.skipUnless(repository_present(), "needs the repository checkout")
class WebImagesTest(SimpleTestCase):
    def test_the_frontend_builds_its_server_from_source_onto_scratch(self):
        text = FRONTEND_DOCKERFILE.read_text(encoding="utf-8")
        self.assertEqual([], frontend_image_problems(text))

    def test_the_proxy_runs_on_alpine_slim(self):
        text = PROXY_DOCKERFILE.read_text(encoding="utf-8")
        self.assertEqual([], proxy_image_problems(text))

    def test_the_e2e_proxy_healthcheck_uses_what_alpine_ships(self):
        compose = load_compose(E2E_COMPOSE.read_text(encoding="utf-8"))
        test = str(compose_service(compose, "e2e-proxy")["healthcheck"]["test"])
        self.assertNotIn("curl", test)
        self.assertIn("127.0.0.1", test)

    def test_scanners_are_pinned_by_version_and_checksum(self):
        for workflow, (version_key, checksum_key) in SCANNER_PINS.items():
            with self.subTest(workflow=workflow.name):
                text = workflow.read_text(encoding="utf-8")
                env = workflow_env(text)
                self.assertRegex(env.get(version_key, ""), _SEMVER)
                self.assertRegex(env.get(checksum_key, ""), _SHA256)
                self.assertIn(f'echo "${{{checksum_key}}}', text)
                self.assertIn("sha256sum -c -", text)

    def test_every_scanned_image_rebuilds_its_scan_on_a_pull_request(self):
        data = yaml.safe_load(SCAN_IMAGES.read_text(encoding="utf-8"))
        triggers = data.get("on", data.get(True))
        paths = triggers["pull_request"]["paths"]
        images = data["jobs"]["pull-request"]["strategy"]["matrix"]["image"]
        published = data["jobs"]["published"]["strategy"]["matrix"]["image"]
        self.assertEqual([f"librephotos-{image}" for image in images], published)
        for image in images:
            with self.subTest(image=image):
                self.assertTrue((DOCKER_DIR / image / "Dockerfile").is_file())
                self.assertIn(f"deploy/docker/{image}/**", paths)

    def test_osv_ignores_expire_and_name_their_blocker(self):
        config = tomllib.loads(OSV_CONFIG.read_text(encoding="utf-8"))
        entries = config.get("IgnoredVulns", [])
        self.assertEqual(
            [], ignore_problems(entries, "effectiveUntil", "reason", date.today())
        )

    def test_trivy_ignores_expire_and_name_their_blocker(self):
        config = yaml.safe_load(TRIVY_IGNORE.read_text(encoding="utf-8")) or {}
        entries = config.get("vulnerabilities") or []
        self.assertEqual(
            [], ignore_problems(entries, "expired_at", "statement", date.today())
        )
