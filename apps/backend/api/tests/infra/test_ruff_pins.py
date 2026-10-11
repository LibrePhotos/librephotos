"""The four ruff pins must name the same version.

Ruff's findings change between releases (and ruff-baseline.toml is generated
with one of them), so pyproject.toml's required-version, requirements.dev.txt,
the pre-commit hook and the lint workflow move together. Regular expressions,
not tomllib: the floor Python (3.10) has none.
"""

import os
import re
import unittest

BACKEND = os.path.dirname(
    os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
)
REPO = os.path.dirname(os.path.dirname(BACKEND))
LINT_WORKFLOW = os.path.join(REPO, ".github", "workflows", "lint-backend.yml")

PINS = {
    os.path.join(BACKEND, "pyproject.toml"): re.compile(
        r'^required-version\s*=\s*"==([0-9][^"]*)"', re.M
    ),
    os.path.join(BACKEND, "requirements.dev.txt"): re.compile(
        r"^ruff==([0-9][^\s;#]*)", re.M
    ),
    os.path.join(BACKEND, ".pre-commit-config.yaml"): re.compile(
        r"astral-sh/ruff-pre-commit\s*\n\s*rev:\s*v([0-9][^\s#]*)"
    ),
    LINT_WORKFLOW: re.compile(r"pip install ruff==([0-9][^\s]*)"),
}


def pin_versions(texts):
    """{file: [versions]} for the pin pattern of each file in `texts`."""
    return {path: PINS[path].findall(text) for path, text in texts.items()}


def mismatches(versions):
    """Problems with `versions`: a file with no pin, or more than one version."""
    problems = [
        f"{os.path.relpath(path, REPO)}: no ruff pin found"
        for path, found in versions.items()
        if not found
    ]
    distinct = {v for found in versions.values() for v in found}
    if len(distinct) > 1:
        problems.append(
            "ruff pins differ: "
            + ", ".join(
                f"{os.path.relpath(path, REPO)}={'/'.join(found)}"
                for path, found in sorted(versions.items())
            )
        )
    return problems


def read_texts():
    texts = {}
    for path in PINS:
        if path == LINT_WORKFLOW and not os.path.exists(path):
            continue  # tests inside the Docker image have no repo root
        with open(path, encoding="utf-8") as handle:
            texts[path] = handle.read()
    return texts


class RuffPinsTests(unittest.TestCase):
    def test_all_pins_name_the_same_version(self):
        texts = read_texts()
        self.assertGreaterEqual(len(texts), 3)
        self.assertEqual(mismatches(pin_versions(texts)), [])

    def test_changing_one_pin_is_caught(self):
        texts = read_texts()
        for path in texts:
            with self.subTest(path=os.path.relpath(path, REPO)):
                [version] = PINS[path].findall(texts[path])
                bumped = dict(texts)
                bumped[path] = texts[path].replace(version, "0.0.1", 1)
                self.assertTrue(mismatches(pin_versions(bumped)))

    def test_removing_a_pin_is_caught(self):
        texts = read_texts()
        path = os.path.join(BACKEND, "requirements.dev.txt")
        texts[path] = re.sub(r"^ruff==.*$", "ruff", texts[path], flags=re.M)
        self.assertTrue(mismatches(pin_versions(texts)))
