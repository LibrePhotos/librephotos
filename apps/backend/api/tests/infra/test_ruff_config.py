"""The backend ruff config: rules, banned APIs and the Python floor it targets.

These run the pinned ruff from the test environment (requirements.dev.txt) and
skip where it is not installed, as in the production image.
"""

import importlib.util
import json
import os
import subprocess
import sys
import unittest

BACKEND = os.path.dirname(
    os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
)
HAS_RUFF = importlib.util.find_spec("ruff") is not None


def run_ruff(*args, stdin=None):
    return subprocess.run(
        [sys.executable, "-m", "ruff", *args],
        cwd=BACKEND,
        input=stdin,
        capture_output=True,
        text=True,
        encoding="utf-8",
        check=False,
    )


@unittest.skipUnless(HAS_RUFF, "ruff is not installed (requirements.dev.txt)")
class PythonFloorSyntaxTests(unittest.TestCase):
    def test_backend_parses_on_python_310(self):
        # The backend-gpu image runs Python 3.10 (CUDA 12.1.1 / ubuntu22.04).
        # Syntax added later (PEP 646 star expressions in subscripts, PEP 701
        # f-strings, ...) is a SyntaxError there and the module fails to import.
        result = run_ruff(
            "check",
            "--no-cache",
            "--exit-zero",
            "--target-version",
            "py310",
            "--select",
            "E9",
            "--output-format",
            "json",
            ".",
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        syntax = [
            f"{os.path.relpath(item['filename'], BACKEND)}:"
            f"{item['location']['row']}: {item['message']}"
            for item in json.loads(result.stdout)
            if item["code"] in (None, "invalid-syntax")
        ]
        self.assertEqual(syntax, [], "syntax Python 3.10 rejects")
