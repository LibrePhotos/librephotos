"""One supported Python range, and CI tests the versions the images run (issue #2372).

``requires-python`` in ``pyproject.toml`` is the only place that names the
supported range. These tests keep everything else inside it: the distro Python
of every backend image, every Python a workflow sets up, the test matrix and
the ``python_version`` markers in the requirements files. The suite itself runs
on the floor (Python 3.10), so ``pyproject.toml`` is read with a regular
expression instead of ``tomllib``. The image and workflow checks need the
repository checkout and skip inside the backend image, which ships
``apps/backend`` only.
"""

import json
import re
import unittest
from fnmatch import fnmatchcase
from pathlib import Path

from api.tests.infra.deploy_files import (
    BACKEND_ROOT,
    DEPLOY_DIR,
    REPO_ROOT,
    WORKFLOWS_DIR,
)

Version = tuple[int, int]

PYPROJECT = BACKEND_ROOT / "pyproject.toml"
TEST_WORKFLOW = WORKFLOWS_DIR / "test-backend.yml"

# The Python a base image ships as `python3`. A backend image on a base that is
# not listed fails test_every_image_runs_a_supported_python: changing the base
# changes the Python, so add the new base here with its Python and make sure
# the test matrix in test-backend.yml covers it.
DISTRO_PYTHON: dict[str, Version] = {
    "ubuntu:noble": (3, 12),
    "nvidia/cuda:*-ubuntu22.04": (3, 10),
}
# Our own base images, which the application images build FROM, and the
# Dockerfile each one is built from (image-backend-base*.yml).
OWN_BASE_IMAGES = {
    "reallibrephotos/librephotos-base": "deploy/docker/backend/base/Dockerfile",
    "reallibrephotos/librephotos-base-gpu": "deploy/docker/backend-gpu/base/Dockerfile",
}

_REQUIRES_PYTHON = re.compile(r'^requires-python\s*=\s*"([^"]*)"', re.MULTILINE)
_RANGE = re.compile(r"^\s*>=\s*3\.(\d+)\s*,\s*<\s*3\.(\d+)\s*$")
_VERSION = re.compile(r"\b(\d+)\.(\d+)\b")
# Case-sensitive on purpose: the GPU Dockerfile has an inline Python script with
# a "from importlib import metadata" line.
_FROM = re.compile(r"^FROM\s+(?:--platform=\S+\s+)?(\S+)", re.MULTILINE)
_MARKER = re.compile(
    r"""python_version\s*(==|!=|<=|>=|<|>|not\s+in|in)\s*["']([^"']*)["']"""
)
_FROM_JSON = re.compile(r"fromJSON\('(\[[^']*\])'\)")


def _version(text: str) -> Version:
    major, minor = text.strip().split(".")[:2]
    return int(major), int(minor)


def _format(version: Version) -> str:
    return f"{version[0]}.{version[1]}"


def supported_range(pyproject_text: str) -> tuple[Version, Version]:
    """(floor, first unsupported) from requires-python, e.g. ((3, 10), (3, 15))."""
    found = _REQUIRES_PYTHON.search(pyproject_text)
    if found is None:
        raise ValueError("pyproject.toml declares no requires-python")
    bounds = _RANGE.match(found.group(1))
    if bounds is None:
        raise ValueError(
            f'requires-python = "{found.group(1)}": write it as ">=3.X,<3.Y"'
        )
    return (3, int(bounds.group(1))), (3, int(bounds.group(2)))


def supported_versions(pyproject_text: str) -> list[Version]:
    floor, ceiling = supported_range(pyproject_text)
    return [(3, minor) for minor in range(floor[1], ceiling[1])]


def final_stage_image(dockerfile_text: str) -> str:
    """The image the last stage builds FROM, which is the image that runs."""
    images = _FROM.findall(dockerfile_text)
    if not images:
        raise ValueError("no FROM line")
    return images[-1]


def distro_python(image: str) -> Version:
    for pattern, version in DISTRO_PYTHON.items():
        if fnmatchcase(image, pattern):
            return version
    raise LookupError(
        f"base image {image} is not in DISTRO_PYTHON "
        "(api/tests/infra/test_python_versions.py): add it with the Python it ships"
    )


def image_python(dockerfile: Path) -> Version:
    """The Python an image runs, through our own base image to the distro."""
    image = final_stage_image(dockerfile.read_text(encoding="utf-8"))
    base = OWN_BASE_IMAGES.get(image.split(":", 1)[0])
    if base is not None:
        return image_python(REPO_ROOT / base)
    return distro_python(image)


def backend_dockerfiles() -> list[Path]:
    """The Dockerfiles that install the backend's requirements."""
    return sorted(
        path
        for path in (DEPLOY_DIR / "docker").rglob("Dockerfile*")
        if "apps/backend/requirements" in path.read_text(encoding="utf-8")
    )


def workflow_pythons(workflow_text: str) -> set[Version]:
    """Every literal Python version a workflow sets up, matrices included."""
    versions: set[Version] = set()
    for line in workflow_text.splitlines():
        key, _, value = line.strip().lstrip("- ").partition(":")
        if key in ("python-version", "python"):
            versions.update(
                (int(major), int(minor)) for major, minor in _VERSION.findall(value)
            )
    return versions


def matrix_lists(workflow_text: str) -> list[set[Version]]:
    """The Python lists of the `python:` matrix: one per event (push, pull request)."""
    for line in workflow_text.splitlines():
        key, _, value = line.strip().lstrip("- ").partition(":")
        if key != "python":
            continue
        lists = [json.loads(raw) for raw in _FROM_JSON.findall(value)]
        if not lists and value.strip().startswith("["):
            lists = [json.loads(value)]
        return [{_version(item) for item in items} for items in lists]
    return []


def missing_from_matrix(images: set[Version], lists: list[set[Version]]) -> list[str]:
    """Image Pythons some matrix list (push or pull request) does not test."""
    return [
        f"{_format(version)} missing from matrix {sorted(map(_format, versions))}"
        for versions in lists
        for version in sorted(images - versions)
    ]


def marker_problems(requirements_text: str, supported: list[Version]) -> list[str]:
    """python_version markers that name a version outside the range or never vary.

    A marker that is true (or false) for every supported Python is a dead
    branch: the floor moved past it and the split can go.
    """
    problems = []
    for number, line in enumerate(requirements_text.splitlines(), start=1):
        for spelled, raw in _MARKER.findall(line):
            operator = " ".join(spelled.split())
            named = [_version(item) for item in raw.split()]
            outside = [v for v in named if v not in supported]
            if outside:
                problems.append(
                    f"line {number}: python_version {operator} {raw!r} names "
                    f"{', '.join(map(_format, outside))}, outside requires-python"
                )
                continue
            results = {_compare(version, operator, named) for version in supported}
            if len(results) == 1:
                problems.append(
                    f"line {number}: python_version {operator} {raw!r} is "
                    f"{results.pop()} for every supported Python"
                )
    return problems


def _compare(version: Version, operator: str, named: list[Version]) -> bool:
    if operator == "in":
        return version in named
    if operator == "not in":
        return version not in named
    [other] = named
    return {
        "==": version == other,
        "!=": version != other,
        "<": version < other,
        "<=": version <= other,
        ">": version > other,
        ">=": version >= other,
    }[operator]


def _pyproject() -> str:
    return PYPROJECT.read_text(encoding="utf-8")


def _repository_present() -> bool:
    return DEPLOY_DIR.is_dir() and WORKFLOWS_DIR.is_dir()


class SupportedRangeTests(unittest.TestCase):
    def test_requires_python_is_a_closed_range(self):
        floor, ceiling = supported_range(_pyproject())
        self.assertLess(floor, ceiling)

    def test_ruff_takes_its_target_from_requires_python(self):
        # A target-version in [tool.ruff] would override requires-python and the
        # two could drift apart.
        tool_ruff = _pyproject().split("[tool.ruff]", 1)[1].split("\n[", 1)[0]
        self.assertIsNone(
            re.search(r"(?m)^target-version\s*=", tool_ruff),
            "[tool.ruff] sets target-version; remove it, requires-python decides",
        )

    def test_mypy_python_version_is_supported(self):
        found = re.search(r'(?m)^python_version\s*=\s*"([^"]+)"', _pyproject())
        assert found is not None
        self.assertIn(_version(found.group(1)), supported_versions(_pyproject()))

    def test_requirements_markers_split_the_supported_range(self):
        supported = supported_versions(_pyproject())
        files = sorted(BACKEND_ROOT.glob("requirements*.txt"))
        self.assertTrue(files)
        for path in files:
            with self.subTest(path.name):
                problems = marker_problems(path.read_text(encoding="utf-8"), supported)
                self.assertEqual(problems, [])


@unittest.skipUnless(_repository_present(), "deploy/ and .github/ are not checked out")
class ImagesAndWorkflowsTests(unittest.TestCase):
    def test_every_image_runs_a_supported_python(self):
        supported = supported_versions(_pyproject())
        dockerfiles = backend_dockerfiles()
        self.assertGreaterEqual(len(dockerfiles), 3)  # backend, backend-gpu, unified
        for dockerfile in dockerfiles:
            with self.subTest(str(dockerfile.relative_to(REPO_ROOT))):
                self.assertIn(image_python(dockerfile), supported)

    def test_every_workflow_python_is_supported(self):
        supported = supported_versions(_pyproject())
        for workflow in sorted(WORKFLOWS_DIR.glob("*.yml")):
            with self.subTest(workflow.name):
                versions = workflow_pythons(workflow.read_text(encoding="utf-8"))
                self.assertEqual(sorted(v for v in versions if v not in supported), [])

    def test_every_image_python_is_in_the_test_matrix(self):
        lists = matrix_lists(TEST_WORKFLOW.read_text(encoding="utf-8"))
        self.assertTrue(lists, "test-backend.yml has no python matrix")
        images = {image_python(path) for path in backend_dockerfiles()}
        self.assertEqual(missing_from_matrix(images, lists), [])


class PlantedViolationTests(unittest.TestCase):
    """The checks above catch what they are for."""

    SUPPORTED = [(3, 10), (3, 11), (3, 12), (3, 13), (3, 14)]

    def test_an_unknown_base_image_fails(self):
        image = final_stage_image("FROM node:24 AS web\nFROM ubuntu:jammy\nRUN true\n")
        with self.assertRaisesRegex(LookupError, "ubuntu:jammy"):
            distro_python(image)

    def test_known_base_images_resolve(self):
        self.assertEqual(distro_python("ubuntu:noble"), (3, 12))
        cuda = "nvidia/cuda:12.1.1-cudnn8-runtime-ubuntu22.04"
        self.assertEqual(distro_python(cuda), (3, 10))

    def test_an_unsupported_workflow_python_is_found(self):
        workflow = 'steps:\n  - uses: actions/setup-python@v7\n    with:\n      python-version: "3.9"\n'
        self.assertEqual(workflow_pythons(workflow), {(3, 9)})

    def test_both_matrix_lists_are_read(self):
        line = (
            "        python: ${{ github.event_name == 'push' && "
            """fromJSON('["3.10", "3.12", "3.14"]') || fromJSON('["3.10"]') }}\n"""
        )
        self.assertEqual(matrix_lists(line), [{(3, 10), (3, 12), (3, 14)}, {(3, 10)}])
        self.assertEqual(matrix_lists('python: ["3.10", "3.12"]'), [{(3, 10), (3, 12)}])
        self.assertEqual(workflow_pythons(line), {(3, 10), (3, 12), (3, 14)})

    def test_an_image_python_missing_from_the_matrix_is_found(self):
        lists = [{(3, 10), (3, 12), (3, 14)}, {(3, 12)}]
        self.assertEqual(
            missing_from_matrix({(3, 10), (3, 12)}, lists),
            ["3.10 missing from matrix ['3.12']"],
        )

    def test_dead_and_out_of_range_markers_are_found(self):
        text = "\n".join(
            [
                'a==1; python_version < "3.11"',
                'b==1; python_version < "3.10"',
                'c==1; python_version >= "3.10"',
                'd==1; python_version == "3.9"',
                'e==1; sys_platform != "linux" or python_version not in "3.10 3.12"',
            ]
        )
        problems = marker_problems(text, self.SUPPORTED)
        self.assertEqual(
            [problem.split(":")[0] for problem in problems],
            ["line 2", "line 3", "line 4"],
        )

    def test_range_parsing(self):
        self.assertEqual(
            supported_range('requires-python = ">=3.10,<3.15"'), ((3, 10), (3, 15))
        )
        with self.assertRaises(ValueError):
            supported_range('requires-python = ">=3.10"')
